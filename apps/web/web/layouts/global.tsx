import type { PropsWithChildren } from 'react'
import { Toaster } from 'sonner'

export default function GlobalLayout({ children }: PropsWithChildren) {
	return (
		<div className="min-h-screen w-full">
			{children}
			<Toaster richColors position="top-right" closeButton />
		</div>
	)
}
