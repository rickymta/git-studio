import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { CommitSignature, SignatureStatus } from '@/lib/types';
import { useRepo } from '@/stores/repo';

const LOOK: Record<
  Exclude<SignatureStatus, 'none'>,
  { label: () => string; help: () => string; tone: string; icon: typeof ShieldCheck }
> = {
  good: {
    label: () => t('Verified'),
    help: () => t('Signed with a trusted key.'),
    tone: 'border-success/60 text-success',
    icon: ShieldCheck,
  },
  untrusted: {
    label: () => t('Signed'),
    help: () => t('Valid signature, but the key is not marked as trusted.'),
    tone: 'border-warning/60 text-warning',
    icon: ShieldCheck,
  },
  expired: {
    label: () => t('Expired signature'),
    help: () => t('The signature or its key has expired.'),
    tone: 'border-warning/60 text-warning',
    icon: ShieldAlert,
  },
  revoked: {
    label: () => t('Revoked key'),
    help: () => t('Signed with a key that has been revoked.'),
    tone: 'border-danger/60 text-danger',
    icon: ShieldAlert,
  },
  bad: {
    label: () => t('Bad signature'),
    help: () => t('The signature does not match this commit.'),
    tone: 'border-danger/60 text-danger',
    icon: ShieldAlert,
  },
  unverifiable: {
    label: () => t('Signed (unverified)'),
    help: () =>
      t(
        'Signed, but it could not be checked here: the key is missing, or for SSH signatures gpg.ssh.allowedSignersFile is not set.',
      ),
    tone: 'border-border text-muted-foreground',
    icon: ShieldQuestion,
  },
};

/** Whether the commit is signed and the signature checks out; nothing for unsigned commits. */
export function SignatureBadge({ hash }: { hash: string }) {
  const path = useRepo((s) => s.path);
  const [sig, setSig] = useState<{ hash: string; value: CommitSignature | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api
      .commitSignature(path, hash)
      .then((value) => live && setSig({ hash, value }))
      .catch(() => live && setSig({ hash, value: null }));
    return () => {
      live = false;
    };
  }, [path, hash]);
  const s = sig?.hash === hash ? sig.value : null;
  if (!s || s.status === 'none') return null;
  const look = LOOK[s.status];
  const Icon = look.icon;
  const detail = [
    look.help(),
    s.signer && `${t('Signer')}: ${s.signer}`,
    s.key && `${t('Key')}: ${s.key}`,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span
      title={detail}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 text-[11px] leading-5',
        look.tone,
      )}
    >
      <Icon className="size-3" />
      {look.label()}
    </span>
  );
}
