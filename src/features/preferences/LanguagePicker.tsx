import { Check, Languages } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';
import { LANGUAGES, systemLang, useLangStore, type Lang } from '@/lib/i18n';

/** Shown once, on first launch, before anything else. Written in both languages on purpose. */
export function LanguagePicker() {
  const setLang = useLangStore((s) => s.setLang);
  const [pick, setPick] = useState<Lang>(systemLang());

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.png" alt="" className="size-11" />
          <div>
            <h1 className="text-xl font-semibold">Welcome to GitStudio</h1>
            <p className="text-muted-foreground">Chào mừng bạn đến với GitStudio</p>
          </div>
        </div>
        <div className="mb-3 flex items-center gap-2 font-medium">
          <Languages className="size-4 text-accent" />
          Choose your language · Chọn ngôn ngữ
        </div>
        <div className="flex flex-col gap-2" role="radiogroup">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={pick === l.id}
              onClick={() => setPick(l.id)}
              onDoubleClick={() => setLang(l.id)}
              className={cn(
                'flex h-12 items-center gap-3 rounded-lg border px-4 text-left text-[15px]',
                pick === l.id
                  ? 'border-accent bg-accent-soft'
                  : 'border-border hover:bg-surface-hover',
              )}
            >
              <span className="flex-1">
                {l.native}
                {l.native !== l.label && (
                  <span className="ml-2 text-xs text-muted-foreground">{l.label}</span>
                )}
              </span>
              {pick === l.id && <Check className="size-4 text-accent" />}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-autofocus
          autoFocus
          onClick={() => setLang(pick)}
          className="mt-5 h-10 w-full rounded-md bg-accent font-medium text-accent-foreground hover:brightness-110"
        >
          {pick === 'vi' ? 'Tiếp tục' : 'Continue'}
        </button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {pick === 'vi'
            ? 'Bạn có thể đổi lại trong Tuỳ chọn → Giao diện.'
            : 'You can change this later in Preferences → UI Customization.'}
        </p>
      </div>
    </div>
  );
}
