import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CalendarClock, Timer, Power, RotateCw, BedDouble, Moon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatDuration } from '@/lib/utils'

type ActionType = 'shutdown' | 'restart' | 'sleep' | 'hibernate'

const ACTION_META: { id: ActionType; icon: React.ElementType; labelKey: string }[] = [
  { id: 'shutdown', icon: Power, labelKey: 'shutdown' },
  { id: 'restart', icon: RotateCw, labelKey: 'restart' },
  { id: 'sleep', icon: BedDouble, labelKey: 'sleep' },
  { id: 'hibernate', icon: Moon, labelKey: 'hibernate' },
]

export function ScheduleCard() {
  const { t } = useTranslation()
  const [action, setAction] = useState<ActionType>('shutdown')
  const [time, setTime] = useState('22:00')
  const [active, setActive] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [scheduledAction, setScheduledAction] = useState<ActionType>('shutdown')

  useEffect(() => {
    const fetchStatus = () =>
      invoke<{ active: boolean; remaining_seconds: number; action?: ActionType }>('get_power_timer_status').then((s) => {
        setActive(s.active)
        setRemaining(s.remaining_seconds)
        if (s.action) setScheduledAction(s.action)
      })
    fetchStatus()
    const id = setInterval(fetchStatus, 1000)
    return () => clearInterval(id)
  }, [])

  const schedule = async () => {
    const [hours, minutes] = time.split(':').map(Number)
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0)
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1)
    }
    const seconds = Math.floor((target.getTime() - now.getTime()) / 1000)
    await invoke('start_power_timer', { action, seconds })
    const s = await invoke<{ active: boolean; remaining_seconds: number; action?: ActionType }>('get_power_timer_status')
    setActive(s.active)
    setRemaining(s.remaining_seconds)
    if (s.action) setScheduledAction(s.action)
  }

  const cancel = async () => {
    await invoke('cancel_power_timer')
    setActive(false)
    setRemaining(0)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t('schedule')}</h2>
            <p className="text-sm text-muted-foreground">
              {active ? `${t(scheduledAction)} • ${formatDuration(remaining)}` : t('inactive')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {ACTION_META.map((a) => {
            const Icon = a.icon
            return (
              <button
                key={a.id}
                type="button"
                disabled={active}
                onClick={() => setAction(a.id)}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-xl border px-3 py-3 text-sm font-medium transition-colors disabled:opacity-50',
                  action === a.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:bg-accent'
                )}
              >
                <Icon className="w-5 h-5" />
                {t(a.labelKey)}
              </button>
            )
          })}
        </div>

        <div className="space-y-3 mb-6">
          <label className="text-sm font-medium">{t('schedule')}</label>
          <div className="flex items-center gap-3">
            <Timer className="w-4 h-4 text-muted-foreground" />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={active}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex gap-3">
          {active ? (
            <button
              type="button"
              onClick={cancel}
              className="flex-1 rounded-xl bg-muted text-foreground px-4 py-3 font-medium hover:bg-muted/80 transition-colors"
            >
              {t('cancel')}
            </button>
          ) : (
            <button
              type="button"
              onClick={schedule}
              className="flex-1 rounded-xl bg-primary text-primary-foreground px-4 py-3 font-medium hover:bg-primary/90 transition-colors"
            >
              {t('setTimer')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
