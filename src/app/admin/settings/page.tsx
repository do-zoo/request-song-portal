import { createServiceClient } from '@/utils/supabase/server'
import { SettingsForm } from '@/components/admin/SettingsForm'
import { redirect } from 'next/navigation'
import type { EventSettings } from '@/types/database'

export default async function AdminSettingsPage() {
  const supabase = await createServiceClient()

  const { data: event } = await supabase
    .from('events')
    .select('id, name, settings')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) redirect('/admin/setup')

  const { data: blacklist } = await supabase
    .from('blacklisted_tracks')
    .select('*')
    .eq('event_id', event.id)
    .order('added_at', { ascending: false })

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings — {event.name}</h1>
        <a href="/admin/queue" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Queue
        </a>
      </div>
      <SettingsForm
        eventId={event.id}
        settings={event.settings as EventSettings}
        blacklist={blacklist ?? []}
      />
    </main>
  )
}
