"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { useAuth } from "@/lib/contexts/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  ShoppingCart,
  DollarSign,
  AlertTriangle,
  LogOut,
  Hourglass,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

type VendorInfo = {
  id: string;
  display_name: string;
  slug: string | null;
  status: "pending" | "approved" | "rejected" | "disabled";
  role: "owner" | "manager" | "staff" | null;
  rejected_reason?: string | null;
  email?: string | null;
};

type ExpiringRow = {
  id: string;
  name: string;
  slug: string;
  expiry_date: string; // YYYY-MM-DD
  stock_qty: number;
  days_left: number;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

function coerceVendor(data: any): VendorInfo | null {
  const arr = Array.isArray(data) ? data : data ? [data] : [];
  const v = arr[0];
  if (!v || !v.id) return null;
  return {
    id: v.id,
    display_name: v.display_name,
    slug: v.slug ?? null,
    status: v.status,
    role: v.role ?? null,
    rejected_reason: v.rejected_reason ?? null,
    email: v.email ?? null,
  } as VendorInfo;
}

function toYmd(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function daysLeftFromYmd(ymd: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(ymd);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

function expiryClass(daysLeft: number, alertDays: number) {
  if (daysLeft < 0) return "bg-red-600 text-white";
  if (daysLeft <= 30) return "bg-red-500 text-white";
  if (daysLeft <= 90) return "bg-orange-500 text-white";
  if (daysLeft <= alertDays) return "bg-yellow-400 text-black";
  return "bg-muted text-foreground";
}

export default function VendorDashboard() {
  const router = useRouter();
  const { user } = useAuth(); // ✅ only user, no logout

  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const [vendorEmail, setVendorEmail] = useState<string | null>(null);

  const [alertDays, setAlertDays] = useState<number>(180);
  const [expiring, setExpiring] = useState<ExpiringRow[]>([]);
  const [productStats, setProductStats] = useState({
    total: 0,
    published: 0,
    lowStock: 0,
    outOfStock: 0,
    expiringCount: 0,
    expiredCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setHydrated(true);
        router.replace("/vendor/login");
        return;
      }

      setHydrated(true);

      const { data, error } = await supabase.rpc("get_my_vendor");
      if (cancelled) return;

      if (error) {
        console.error("get_my_vendor error", error);
        setVendor(null);
        setLoading(false);
        return;
      }

      const v = coerceVendor(data);
      setVendor(v);

      if (v?.email) setVendorEmail(v.email);
      else if (v?.id) {
        const { data: vendRow } = await supabase
          .from("vendors")
          .select("email")
          .eq("id", v.id)
          .maybeSingle();
        setVendorEmail((vendRow as any)?.email ?? null);
      }

      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      setHydrated(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  // Load alert window + expiring products + compute stats
  useEffect(() => {
    if (!vendor?.id || vendor.status !== "approved") return;

    (async () => {
      // vendor expiry window
      const { data: vset } = await supabase
        .from("vendors")
        .select("expiry_alert_days")
        .eq("id", vendor.id)
        .maybeSingle();

      const d = Number((vset as any)?.expiry_alert_days ?? 180);
      const windowDays = Number.isFinite(d) && d > 0 ? d : 180;
      setAlertDays(windowDays);

      // expiring list (ONLY within window)
      const end = toYmd(new Date(Date.now() + windowDays * 86400000));
      const { data: prod, error: pErr } = await supabase
        .from("products")
        .select("id,name,slug,expiry_date,stock_qty,is_published,track_inventory")
        .eq("vendor_id", vendor.id)
        .not("expiry_date", "is", null)
        .lte("expiry_date", end)
        .order("expiry_date", { ascending: true })
        .limit(25);

      if (pErr) {
        console.error(pErr);
        setExpiring([]);
      } else {
        const list = (prod ?? []).map((p: any) => {
          const ymd = String(p.expiry_date).slice(0, 10);
          const dl = daysLeftFromYmd(ymd);
          return {
            id: p.id,
            name: p.name,
            slug: p.slug,
            expiry_date: ymd,
            stock_qty: Number(p.stock_qty ?? 0),
            days_left: dl,
          } as ExpiringRow;
        });
        setExpiring(list);
      }

      // product stats
      const { data: allProd } = await supabase
        .from("products")
        .select("id,is_published,track_inventory,stock_qty,expiry_date")
        .eq("vendor_id", vendor.id);

      const todayYmd = toYmd(new Date());
      const endYmd = end;

      let total = 0;
      let published = 0;
      let lowStock = 0;
      let outOfStock = 0;
      let expiringCount = 0;
      let expiredCount = 0;

      for (const p of (allProd ?? []) as any[]) {
        total += 1;
        if (p.is_published) published += 1;

        const tracking = p.track_inventory ?? true;
        const qty = Number(p.stock_qty ?? 0);

        if (tracking) {
          if (qty === 0) outOfStock += 1;
          else if (qty > 0 && qty <= 5) lowStock += 1;
        }

        const exp = p.expiry_date ? String(p.expiry_date).slice(0, 10) : null;
        if (exp) {
          if (exp < todayYmd) expiredCount += 1;
          else if (exp >= todayYmd && exp <= endYmd) expiringCount += 1;
        }
      }

      setProductStats({
        total,
        published,
        lowStock,
        outOfStock,
        expiringCount,
        expiredCount,
      });
    })();
  }, [vendor?.id, vendor?.status]);

  const statusBadge = (s?: VendorInfo["status"]) => {
    if (s === "approved") return <Badge>Approved</Badge>;
    if (s === "pending") return <Badge variant="secondary">Pending</Badge>;
    if (s === "rejected") return <Badge variant="destructive">Rejected</Badge>;
    if (s === "disabled") return <Badge variant="outline">Disabled</Badge>;
    return null;
  };

  // ✅ FIXED LOGOUT
  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message || "Logout failed");
      return;
    }
    toast.success("Logged out successfully");
    router.push("/");
  };

  if (!hydrated || loading) {
    return (
      <div className="container mx-auto py-16 text-muted-foreground">
        Loading vendor workspace…
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Become a Vendor</CardTitle>
            <CardDescription>
              Create a vendor account to access the portal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full" onClick={() => router.push("/vendor/register")}>
              Create Vendor Account
            </Button>
            <div className="text-xs text-muted-foreground text-center">
              Already applied? Sign in via{" "}
              <Link href="/vendor/login" className="underline">
                Vendor Login
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (vendor.status === "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardHeader>
            <Hourglass className="h-10 w-10 mx-auto text-amber-500 mb-2" />
            <CardTitle className="text-2xl">Application in Review</CardTitle>
            <CardDescription>
              Thanks, <b>{vendor.display_name}</b>. We’ll notify you once approved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.push("/")}>
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (vendor.status === "rejected" || vendor.status === "disabled") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardHeader>
            <ShieldAlert className="h-10 w-10 mx-auto text-red-500 mb-2" />
            <CardTitle className="text-2xl">
              {vendor.status === "rejected" ? "Application Rejected" : "Account Disabled"}
            </CardTitle>
            <CardDescription>
              {vendor.rejected_reason
                ? `Reason: ${vendor.rejected_reason}`
                : "Please contact support."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" onClick={() => router.push("/")}>
              Back to Home
            </Button>
            <div className="text-xs text-muted-foreground">
              Need help? Email support@madeinkorea.in
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Vendor Portal</h1>
            {statusBadge(vendor.status)}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {vendor.display_name}
              {(vendorEmail || user?.email) ? <> · {vendorEmail ?? user?.email}</> : null}
            </span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto py-8 space-y-8">
        <div>
          <h2 className="text-3xl font-bold mb-2">Dashboard</h2>
          <p className="text-muted-foreground">
            Expiry window: <b>{alertDays}</b> days
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Products (Total)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{productStats.total}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Published: {productStats.published}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Stock Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {productStats.outOfStock + productStats.lowStock}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Out: {productStats.outOfStock} • Low: {productStats.lowStock}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Expiring Soon
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{productStats.expiringCount}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Within {alertDays} days
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Expired
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{productStats.expiredCount}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Already expired
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Expiry list */}
        <Card>
          <CardHeader>
            <CardTitle>Expiry Alerts</CardTitle>
            <CardDescription>
              Products expiring within the next {alertDays} days (includes already expired).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {expiring.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No products expiring within the alert window.
              </div>
            ) : (
              expiring.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between border rounded-md p-3"
                >
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Expiry: {p.expiry_date} • Stock: {p.stock_qty}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${expiryClass(
                        p.days_left,
                        alertDays
                      )}`}
                    >
                      {p.days_left < 0
                        ? `${Math.abs(p.days_left)}d expired`
                        : `${p.days_left}d left`}
                    </span>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/vendor/products/${p.id}`)}
                    >
                      Open
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <Package className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Products</CardTitle>
              <CardDescription>Manage your product catalog</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Add new products, update inventory, and manage pricing.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/products")}
              >
                Manage Products
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <ShoppingCart className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Orders</CardTitle>
              <CardDescription>View and fulfill orders</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Process orders, update tracking, and manage fulfillment.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/orders")}
              >
                View Orders
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <DollarSign className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Payouts</CardTitle>
              <CardDescription>Track your earnings</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                View payout statements, earnings, and transaction history.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/payouts")}
              >
                View Payouts
              </Button>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <AlertTriangle className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Alerts</CardTitle>
              <CardDescription>Monitor inventory and expiry</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                View low stock, out of stock, and expiry alerts.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => router.push("/vendor/alerts")}
              >
                View Alerts
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
