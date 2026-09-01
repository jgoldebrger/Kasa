import { ImageResponse } from 'next/og'

export const alt = 'Kasa — membership books for kehilla treasurers'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 80,
        background: '#F7F7F5',
        color: '#0a0c0b',
      }}
    >
      <div
        style={{
          display: 'flex',
          width: 56,
          height: 56,
          borderRadius: 8,
          background: '#0a0c0b',
          color: '#F7F7F5',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
          fontWeight: 600,
          marginBottom: 32,
        }}
      >
        K
      </div>
      <div style={{ fontSize: 56, fontWeight: 600, lineHeight: 1.15, maxWidth: 960 }}>
        Membership books for kehilla treasurers
      </div>
      <div style={{ fontSize: 28, marginTop: 24, opacity: 0.7 }}>
        Age-based dues, Hebrew-calendar statements, family balances
      </div>
    </div>,
    { ...size },
  )
}
