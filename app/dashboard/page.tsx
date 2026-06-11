import { redirect } from 'next/navigation'

// The real dashboard lives at "/". Preserve any old bookmarks pointing at
// "/dashboard" by issuing a server-side redirect.
export default function DashboardRedirect() {
  redirect('/')
}
