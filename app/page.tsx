import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-muted/30">
      {/* Top bar */}
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            {/* Replace with your logo if you have */}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold">
              MK
            </div>
            <div className="leading-tight">
              <div className="font-semibold">MadenKorea</div>
              <div className="text-xs text-muted-foreground">
                Vendor Portal
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/vendor/login"
              className="hidden sm:inline-flex h-10 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted"
            >
              Vendor Login
            </Link>
            <Link
              href="/vendor"
              className="inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          {/* Left */}
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Vendor workspace is live
            </div>

            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Manage Products, Stock & Expiry — in one place
            </h1>

            <p className="text-muted-foreground">
              Use the MadenKorea Vendor Portal to update product inventory,
              expiry dates, pricing and view alerts for low stock or expiring
              items.
            </p>

            {/* CTAs */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/vendor"
                className="inline-flex h-11 w-full items-center justify-center rounded-md bg-foreground px-5 text-sm font-medium text-background hover:opacity-90 sm:w-auto"
              >
                Open Vendor Dashboard
              </Link>

              <Link
                href="/vendor/login"
                className="inline-flex h-11 w-full items-center justify-center rounded-md border bg-background px-5 text-sm font-medium hover:bg-muted sm:w-auto"
              >
                Login / Register
              </Link>
            </div>

            <div className="text-xs text-muted-foreground">
              Tip: If you already have access, click <b>Open Vendor Dashboard</b>.
            </div>
          </div>

          {/* Right card */}
          <div className="rounded-2xl border bg-background p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">What you can do</div>
              <div className="text-xs text-muted-foreground">Vendor tools</div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border p-4">
                <div className="text-sm font-medium">Inventory</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Update stock qty, enable/disable tracking.
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm font-medium">Expiry Alerts</div>
                <div className="text-xs text-muted-foreground mt-1">
                  See products within your alert window (180 days).
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm font-medium">Products</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Edit product details, pricing and visibility.
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm font-medium">Orders</div>
                <div className="text-xs text-muted-foreground mt-1">
                  View vendor orders and fulfillment info.
                </div>
              </div>
            </div>

            {/* Optional illustration */}
            

            
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>© {new Date().getFullYear()} MadenKorea — Vendor Portal</div>
          <div className="flex gap-4">
            <Link href="/vendor/login" className="hover:underline">
              Login
            </Link>
            <Link href="/vendor" className="hover:underline">
              Dashboard
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
