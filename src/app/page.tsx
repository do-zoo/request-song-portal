import { JoinForm } from '@/components/JoinForm'

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ pin?: string; error?: string }>
}) {
  const { pin, error } = await searchParams

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-zinc-50">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-zinc-900">Song Request</h1>
        <p className="text-zinc-500 mt-2">Masukkan kode event untuk request lagu</p>
      </div>
      {error === 'invalid_session' && (
        <p className="mb-4 text-red-500 text-sm">Sesi kamu expired, silakan masuk lagi.</p>
      )}
      <JoinForm defaultPin={pin} />
    </main>
  )
}
