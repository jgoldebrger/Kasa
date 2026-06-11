export default function WelcomeLoading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      role="status"
      aria-label="Loading welcome"
    >
      <div className="w-full max-w-md space-y-4">
        <div className="ui-skeleton mx-auto h-12 w-12 rounded-full" />
        <div className="ui-skeleton mx-auto h-6 w-56 rounded-md" />
        <div className="ui-skeleton mx-auto h-4 w-72 rounded-md" />
        <div className="ui-skeleton h-32 rounded-lg" />
      </div>
    </div>
  )
}
