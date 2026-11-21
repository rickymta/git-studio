import { AlertTriangle, CheckCircle2, ExternalLink, GitMerge } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Checkbox, Select } from '@/components/controls';
import { Button, Modal, Spinner } from '@/components/ui';
import { t } from '@/lib/i18n';
import { api, type MergeArgs } from '@/lib/ipc';
import { copyText, openUrl } from '@/lib/native';
import type { MergeInfo } from '@/lib/types';
import { useGitHub } from '@/stores/github';
import { useGitLab } from '@/stores/gitlab';
import { useMergePreview, usePullMerge, type PullMergeSpec } from '@/stores/mergePreview';
import { useRepo } from '@/stores/repo';
import { notify, toast } from '@/stores/ui';
import * as A from '../actions';
import { hostWords } from '../pulls/hosting';

type Method = MergeArgs['method'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mergeability from the host, asking again while it is still being worked out. */
async function loadInfo(spec: PullMergeSpec, tries = 6): Promise<MergeInfo> {
  for (let i = 0; ; i++) {
    const info =
      spec.kind === 'github'
        ? await api.ghMergeInfo(
            spec.project.split('/')[0]!,
            spec.project.split('/')[1]!,
            spec.number,
          )
        : await api.glMergeInfo(spec.project, spec.number);
    if (info.mergeable !== null || i >= tries - 1) return info;
    await sleep(1500);
  }
}

async function mergeOnHost(spec: PullMergeSpec, method: Method, deleteBranch: boolean) {
  const args: MergeArgs = { project: spec.project, number: spec.number, method, deleteBranch };
  return spec.kind === 'github' ? api.ghMergePull(args) : api.glMergeMergeRequest(args);
}

function reloadPulls(spec: PullMergeSpec) {
  if (spec.kind === 'github') {
    const [owner, repo] = spec.project.split('/');
    void useGitHub.getState().loadPulls({ owner: owner!, repo: repo! });
  } else void useGitLab.getState().loadPulls(spec.project);
}

function announceMerged(spec: PullMergeSpec, info: MergeInfo) {
  const w = hostWords(spec.kind);
  notify({
    kind: 'success',
    title: t('Merged {ref} into {base}', { ref: w.ref(spec.number), base: info.baseRef }),
    detail: info.title,
    actions: [
      { label: w.openOne, run: () => void openUrl(info.htmlUrl) },
      { label: t('Copy link'), run: () => void copyText(info.htmlUrl) },
    ],
  });
}

export function PullMergeDialog() {
  const spec = usePullMerge((s) => s.spec);
  if (!spec) return null;
  return <Dialog spec={spec} key={`${spec.project}#${spec.number}`} />;
}

/**
 * Merge a pull request (GitHub) or merge request (GitLab). When the host can merge it, it is
 * merged there. When it conflicts with its base, the conflicts are resolved here: the base is
 * merged into the request's branch in the merge preview, the branch is pushed, and the host
 * then merges it.
 */
function Dialog({ spec }: { spec: PullMergeSpec }) {
  const close = usePullMerge((s) => s.close);
  const w = hostWords(spec.kind);
  const [info, setInfo] = useState<MergeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>('merge');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadInfo(spec)
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [spec]);

  const sameRepo = !!info && info.headRepo === spec.project;
  const title =
    spec.kind === 'github'
      ? t('Merge pull request {ref}', { ref: w.ref(spec.number) })
      : t('Merge merge request {ref}', { ref: w.ref(spec.number) });

  const mergeHere = async () => {
    if (!info) return;
    setBusy(true);
    try {
      const out = await mergeOnHost(spec, method, deleteBranch);
      if (!out.merged) throw new Error(out.message || t('The host did not merge it.'));
      announceMerged(spec, info);
      reloadPulls(spec);
      // Bring the merge commit and the moved base branch down.
      void useRepo.getState().run(t('Fetch'), (p) => api.fetch(p, spec.remote));
      close();
    } catch (e) {
      toast('error', t('Could not merge {ref}', { ref: w.ref(spec.number) }), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Resolve the conflicts locally: base into the request's branch, push, merge on the host. */
  const resolveLocally = async () => {
    if (!info) return;
    setBusy(true);
    const run = useRepo.getState().run;
    const fetched = await run(t('Fetch'), (p) => api.fetch(p, spec.remote));
    if (!fetched) {
      setBusy(false);
      return;
    }
    const head = `${spec.remote}/${info.headRef}`;
    const ref = useRepo.getState().refs?.refs.find((r) => r.kind === 'remote' && r.name === head);
    if (!ref) {
      setBusy(false);
      toast('error', t('{name} was not found after fetching', { name: head }));
      return;
    }
    if (useRepo.getState().info?.status.branch !== info.headRef) await A.checkoutRef(ref);
    if (useRepo.getState().info?.status.branch !== info.headRef) {
      setBusy(false);
      return; // checkout cancelled or failed (it said why)
    }
    const chosen = { method, deleteBranch };
    close();
    setBusy(false);
    useMergePreview.getState().show({
      theirs: `${spec.remote}/${info.baseRef}`,
      label: `${spec.remote}/${info.baseRef}`,
      actionLabel:
        spec.kind === 'github'
          ? t('Merge, push and merge the PR')
          : t('Merge, push and merge the MR'),
      after: async () => {
        await A.push({ branch: info.headRef, remote: spec.remote });
        // The host re-checks mergeability after the push.
        let fresh = await loadInfo(spec, 10);
        for (let i = 0; i < 5 && fresh.mergeable !== true; i++) {
          await sleep(2000);
          fresh = await loadInfo(spec, 1);
        }
        if (fresh.mergeable !== true) {
          notify({
            kind: 'warning',
            title: t('Pushed {branch}; {ref} cannot be merged yet', {
              branch: info.headRef,
              ref: w.ref(spec.number),
            }),
            detail: t('Status on {host}: {state}', { host: w.host, state: fresh.mergeState }),
            actions: [{ label: w.openOne, run: () => void openUrl(info.htmlUrl) }],
          });
          reloadPulls(spec);
          return;
        }
        try {
          const out = await mergeOnHost(spec, chosen.method, chosen.deleteBranch);
          if (!out.merged) throw new Error(out.message || t('The host did not merge it.'));
          announceMerged(spec, fresh);
          reloadPulls(spec);
          void useRepo.getState().run(t('Fetch'), (p) => api.fetch(p, spec.remote));
        } catch (e) {
          toast(
            'error',
            t('Could not merge {ref}', { ref: w.ref(spec.number) }),
            (e as Error).message,
          );
        }
      },
    });
  };

  const methods: { value: Method; label: string }[] =
    spec.kind === 'github'
      ? [
          { value: 'merge', label: t('Create a merge commit') },
          { value: 'squash', label: t('Squash and merge') },
          { value: 'rebase', label: t('Rebase and merge') },
        ]
      : [
          { value: 'merge', label: t('Merge') },
          { value: 'squash', label: t('Squash commits') },
        ];

  return (
    <Modal open onClose={close} title={title} width={560}>
      {error ? (
        <div className="text-danger">{error}</div>
      ) : !info ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner /> {t('Checking with {host}…', { host: w.host })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <div className="font-medium">{info.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {info.headRef} → {info.baseRef}
              {info.draft && ` · ${t('Draft')}`}
            </div>
          </div>

          <div className="rounded-md border border-border bg-background p-3">
            {info.state !== 'open' && info.state !== 'opened' ? (
              <span className="text-muted-foreground">
                {t('This request is {state}.', { state: info.state })}
              </span>
            ) : info.mergeable === true ? (
              <span className="flex items-center gap-2 text-success">
                <CheckCircle2 className="size-4" />{' '}
                {t('Ready to merge on {host}.', { host: w.host })}
              </span>
            ) : info.conflicts ? (
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="size-4" />{' '}
                  {t('{head} conflicts with {base}.', { head: info.headRef, base: info.baseRef })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {sameRepo
                    ? t(
                        'Resolve it here: GitStudio merges {base} into {head} with a preview to resolve the conflicts, pushes {head}, then merges the request on {host}.',
                        { base: info.baseRef, head: info.headRef, host: w.host },
                      )
                    : t(
                        'The branch lives in a fork, so only its author can push the resolution. Ask them to merge {base} into it, or merge it on {host}.',
                        { base: info.baseRef, host: w.host },
                      )}
                </span>
              </div>
            ) : info.mergeable === null ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Spinner />{' '}
                {t('{host} is still checking whether it can be merged.', { host: w.host })}
              </span>
            ) : (
              <span className="flex items-center gap-2 text-warning">
                <AlertTriangle className="size-4" />{' '}
                {t('Not mergeable yet ({state}): checks, approvals or branch rules.', {
                  state: info.mergeState,
                })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-muted-foreground">{t('Merge method')}</span>
            <Select
              value={method}
              onChange={(v) => setMethod(v as Method)}
              options={methods}
              className="w-64"
            />
          </div>
          {sameRepo && (
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={deleteBranch} onChange={setDeleteBranch} />
              {t('Delete {branch} after merging', { branch: info.headRef })}
            </label>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button variant="ghost" onClick={() => void openUrl(info.htmlUrl)}>
              <ExternalLink className="size-3.5" /> {w.open}
            </Button>
            <div className="flex-1" />
            {info.conflicts && sameRepo && (
              <Button disabled={busy} onClick={() => void resolveLocally()}>
                {t('Resolve conflicts here')}
              </Button>
            )}
            <Button
              variant="primary"
              disabled={busy || info.mergeable !== true}
              onClick={() => void mergeHere()}
            >
              {busy ? <Spinner /> : <GitMerge className="size-3.5" />}{' '}
              {t('Merge on {host}', { host: w.host })}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
