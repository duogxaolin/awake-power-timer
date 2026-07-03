import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Moon, Sun, Bell, Power, Monitor, Cpu, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type Theme = 'light' | 'dark' | 'system'
type Mode = 'display' | 'system' | 'both'

interface SettingsState {
  theme: Theme
  language: string
  autostart: boolean
  defaultMode: Mode
  notifications: boolean
}

export function SettingsCard({ isDark: _isDark, setIsDark }: { isDark: boolean; setIsDark: (v: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const [settings, setSettings] = useState<SettingsState>({
    theme: 'dark',
    language: 'en',
    autostart: false,
    defaultMode: 'both',
    notifications: true,
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const savedSettings = localStorage.getItem('apt-settings')
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings) as SettingsState
        setSettings((s) => ({ ...s, ...parsed }))
        i18n.changeLanguage(parsed.language).catch(() => {})
      } catch {
        // ignore
      }
    }
  }, [i18n])

  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    if (key === 'language') {
      i18n.changeLanguage(value as string).catch(() => {})
    }
    if (key === 'theme') {
      if (value === 'dark') setIsDark(true)
      else if (value === 'light') setIsDark(false)
      else setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
    }
  }

  const save = async () => {
    localStorage.setItem('apt-settings', JSON.stringify(settings))
    await invoke('set_autostart', { enabled: settings.autostart })
    await invoke('set_notifications_enabled', { enabled: settings.notifications })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-6">{t('settings')}</h2>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              {settings.theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              {t('theme')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['light', 'dark', 'system'] as Theme[]).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => update('theme', theme)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    settings.theme === theme ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-accent'
                  )}
                >
                  {t(theme)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t('language')}</label>
            <select
              value={settings.language}
              onChange={(e) => update('language', e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ring-ring"
            >
              <option value="en">English</option>
              <option value="vi">Tiếng Việt</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t('defaultKeepAwakeMode')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['display', 'system', 'both'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => update('defaultMode', m)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    settings.defaultMode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-accent'
                  )}
                >
                  {m === 'display' && <Monitor className="w-4 h-4" />}
                  {m === 'system' && <Cpu className="w-4 h-4" />}
                  {m === 'both' && <Zap className="w-4 h-4" />}
                  {m === 'display' ? t('displayAwake') : m === 'system' ? t('systemAwake') : t('bothAwake')}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-border bg-background p-3">
            <span className="text-sm font-medium flex items-center gap-2">
              <Power className="w-4 h-4 text-muted-foreground" />
              {t('autostart')}
            </span>
            <button
              type="button"
              onClick={() => update('autostart', !settings.autostart)}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                settings.autostart ? 'bg-primary' : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  settings.autostart ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </label>

          <label className="flex items-center justify-between rounded-xl border border-border bg-background p-3">
            <span className="text-sm font-medium flex items-center gap-2">
              <Bell className="w-4 h-4 text-muted-foreground" />
              {t('notifications')}
            </span>
            <button
              type="button"
              onClick={() => update('notifications', !settings.notifications)}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                settings.notifications ? 'bg-primary' : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  settings.notifications ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </label>
        </div>

        <button
          type="button"
          onClick={save}
          className={cn(
            'mt-6 w-full rounded-xl px-4 py-3 font-medium transition-colors',
            saved ? 'bg-green-600 text-white' : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
        >
          {saved ? 'Saved' : t('save')}
        </button>
      </div>
    </div>
  )
}
