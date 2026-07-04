import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { History, Trash2, Timer, XCircle, Power, CalendarClock, Hourglass, BatteryLow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type EventKind =
  | 'timer_started'
  | 'timer_cancelled'
  | 'action_executed'
  | 'schedule_fired'
  | 'idle_fired'
  | 'battery_fired'

interface ActivityEvent {
  timestamp: string
  kind: EventKind
  detail: string
}

const KIND_META: Record<EventKind, { icon: React.ElementType; tone: string }> = {
  timer_started: { icon: Timer, tone: 'text-primary' },
  timer_cancelled: { icon: XCircle, tone: 'text-muted-foreground' },
  action_executed: { icon: Power, tone: 'text-rose-500' },
  schedule_fired: { icon: CalendarClock, tone: 'text-sky-500' },
  idle_fired: { icon: Hourglass, tone: 'text-amber-500' },
  battery_fired: { icon: BatteryLow, tone: 'text-rose-500' },
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function HistoryCard() {
  const { t } = useTranslation()
  const [events, setEvents] = useState<ActivityEvent[]>([])

  const load = async () => {
    try {
      const log = await invoke<ActivityEvent[]>('get_activity_log')
      setEvents(log)
    } catch {
      // backend not ready
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  const clear = async () => {
    try {
      await invoke('clear_activity_log')
      setEvents([])
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t('activityLog')}</h2>
              <p className="text-sm text-muted-foreground">{t('activityLogDesc')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={events.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            {t('clearLog')}
          </button>
        </div>

        {events.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">{t('noActivity')}</div>
        ) : (
          <ul className="space-y-2">
            {events.map((e, i) => {
              const meta = KIND_META[e.kind] ?? KIND_META.timer_started
              const Icon = meta.icon
              return (
                <li key={`${e.timestamp}-${i}`} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                  <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', meta.tone)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{e.detail}</div>
                    <div className="text-xs text-muted-foreground">{formatTimestamp(e.timestamp)}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
