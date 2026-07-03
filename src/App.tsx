import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Moon, Sun, Settings, Zap, Timer, CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { KeepAwakeCard } from '@/components/KeepAwakeCard'
import { PowerTimerCard } from '@/components/PowerTimerCard'
import { ScheduleCard } from '@/components/ScheduleCard'
import { SettingsCard } from '@/components/SettingsCard'
import { cn } from '@/lib/utils'

type Tab = 'awake' | 'timer' | 'schedule' | 'settings'

export default function App() {
  const { t, i18n } = useTranslation()
  const [activeTab, setActiveTab] = useState<Tab>('awake')
  const [isDark, setIsDark] = useState(true)
  const [awakeActive, setAwakeActive] = useState(false)
  const [timerActive, setTimerActive] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  useEffect(() => {
    const interval = setInterval(() => {
      invoke<{ active: boolean }>('get_keep_awake_status').then((s) => setAwakeActive(s.active))
      invoke<{ active: boolean }>('get_power_timer_status').then((s) => setTimerActive(s.active))
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'awake', label: t('keepAwake'), icon: Zap },
    { id: 'timer', label: t('powerTimer'), icon: Timer },
    { id: 'schedule', label: t('schedule'), icon: CalendarClock },
    { id: 'settings', label: t('settings'), icon: Settings },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shadow-sm', awakeActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t('appName')}</h1>
            <p className="text-xs text-muted-foreground">
              {awakeActive ? t('active') : t('inactive')} {timerActive && `• ${t('powerTimer')}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsDark((d) => !d)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-background hover:bg-accent transition-colors"
            aria-label={isDark ? t('light') : t('dark')}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <select
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:ring-2 ring-ring"
          >
            <option value="en">English</option>
            <option value="vi">Tiếng Việt</option>
          </select>
        </div>
      </header>

      <nav className="px-6 pt-4">
        <div className="inline-flex gap-1 p-1 rounded-xl bg-muted border border-border">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  activeTab === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </nav>

      <main className="flex-1 p-6 overflow-auto">
        {activeTab === 'awake' && <KeepAwakeCard />}
        {activeTab === 'timer' && <PowerTimerCard />}
        {activeTab === 'schedule' && <ScheduleCard />}
        {activeTab === 'settings' && <SettingsCard isDark={isDark} setIsDark={setIsDark} />}
      </main>
    </div>
  )
}
