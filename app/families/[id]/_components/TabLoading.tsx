export default function TabLoading() {
  return (
    <div className="py-8 flex justify-center" role="status" aria-label="Loading tab">
      <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
    </div>
  )
}
