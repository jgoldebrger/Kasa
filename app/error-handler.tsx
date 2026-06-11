// Global error handler to suppress react-jewish-datepicker errors
if (typeof window !== 'undefined') {
  const originalError = window.onerror
  const originalUnhandledRejection = window.onunhandledrejection

  window.onerror = (message, source, lineno, colno, error) => {
    // Suppress the onMouseOver error from react-jewish-datepicker
    if (
      message?.toString().includes('onMouseOver') ||
      message?.toString().includes('day.js') ||
      source?.includes('react-jewish-datepicker') ||
      source?.includes('day.js')
    ) {
      console.warn('Suppressed Hebrew date picker error:', message)
      return true // Suppress the error
    }
    if (originalError) {
      return originalError(message, source, lineno, colno, error)
    }
    return false
  }

  window.onunhandledrejection = (event) => {
    // Suppress unhandled promise rejections from the datepicker
    if (
      event.reason?.message?.includes('onMouseOver') ||
      event.reason?.stack?.includes('day.js') ||
      event.reason?.stack?.includes('react-jewish-datepicker')
    ) {
      console.warn('Suppressed Hebrew date picker promise rejection:', event.reason)
      event.preventDefault()
      return
    }
    if (originalUnhandledRejection && typeof originalUnhandledRejection === 'function') {
      originalUnhandledRejection.call(window, event)
    }
  }
}

