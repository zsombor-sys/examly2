'use client'

import React from 'react'

export default function HScroll({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={
        'flex min-w-0 overflow-x-auto overflow-y-hidden no-scrollbar ' + (className ?? '')
      }
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {children}
    </div>
  )
}
