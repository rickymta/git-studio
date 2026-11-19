import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { appResourceDir } from '@/lib/native';
import { useRepo } from '@/stores/repo';
import { confirm, toast } from '@/stores/ui';

const ASKED = 'gitstudio.overlaySetupAsked';

/**
 * File-manager status icons are on by default. On first launch, finish the setup: macOS and
 * Linux need no permission, Windows asks once (registering an Explorer overlay needs an
 * administrator prompt); declining turns the preference off.
 */
export async function ensureOverlaySetup(): Promise<void> {
  const settings = useRepo.getState().settings;
  if (!settings?.overlayIcons) return;
  try {
    if (localStorage.getItem(ASKED)) return;
  } catch {
    return;
  }
  const dir = await appResourceDir();
  let info;
  try {
    info = await api.overlayInfo(dir);
  } catch {
    return;
  }
  if (info.installed) return;
  try {
    localStorage.setItem(ASKED, '1');
  } catch {
    /* ignore */
  }
  if (info.platform === 'windows') {
    const ok = await confirm(
      t('Git status icons in Explorer'),
      t(
        'GitStudio can show a badge on every repository folder in Explorer: green when clean, orange with changes, red when it needs attention. Windows asks for administrator permission once to install it. You can change this later in Preferences → File manager icons.',
      ),
      t('Turn on'),
    );
    if (!ok) {
      try {
        useRepo
          .getState()
          .setSettings(await api.saveSettings({ ...settings, overlayIcons: false }));
      } catch {
        /* keep the default */
      }
      return;
    }
  }
  try {
    await api.overlayEnable(dir);
    toast('success', t('File manager icons turned on'));
  } catch (e) {
    toast('error', t('Could not change the file manager icons'), (e as Error).message);
  }
}
