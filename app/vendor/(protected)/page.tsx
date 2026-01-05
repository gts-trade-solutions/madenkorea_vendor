"use client";

import { useEffect, useMemo, useState } from "react";
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

type ExpiringUnitRow = {
  unit_id: string;
  unit_code: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  expiry_date: string; // YYYY-MM-DD
  days_left: number;
  status: "IN_STOCK" | "INVOICED" | "DEMO";
};

type ProductUnitAgg = {
  product_id: string;
  product_name: string;
  product_slug: string;
  in_stock: number;
  invoiced: number;
  demo: number;
  sold: number;
  returned: number;
  total: number;
  next_expiry_date: string | null;
  next_expiry_days_left: number | null;
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
  const { user } = useAuth();

  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);

  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const [vendorEmail, setVendorEmail] = useState<string | null>(null);

  const [alertDays, setAlertDays] = useState<number>(180);

  // New: unit-based stats
  const [unitStats, setUnitStats] = useState({
    productsWithUnits: 0,
    totalUnits: 0,
    inStockUnits: 0,
    lowStockProducts: 0,
    outOfStockProducts: 0,
    expiringUnits: 0,
    expiredUnits: 0,
  });

  // New: expiring UNITS list (not products)
  const [expiringUnits, setExpiringUnits] = useState<ExpiringUnitRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();

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

    const { data: sub } = supabase.auth.onAuthStateChange(() => setHydrated(true));

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  // ✅ Unit-based alerts & stats
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

      const todayYmd = toYmd(new Date());
      const endYmd = toYmd(new Date(Date.now() + windowDays * 86400000));

      // Fetch products (id/name/slug)
      const { data: products, error: pErr } = await supabase
        .from("products")
        .select("id,name,slug")
        .eq("vendor_id", vendor.id)
        .limit(5000);

      if (pErr) {
        console.error(pErr);
        toast.error(pErr.message || "Failed to load products");
        return;
      }

      const productMap = new Map<string, { name: string; slug: string }>();
      for (const p of (products ?? []) as any[]) {
        productMap.set(p.id, { name: p.name, slug: p.slug });
      }

      // Fetch units (expiry_date based)
      // NOTE: If your DB uses exp_date, change "expiry_date" below to "exp_date"
      const { data: units, error: uErr } = await supabase
        .from("inventory_units")
        .select("id,product_id,unit_code,status,expiry_date")
        .eq("vendor_id", vendor.id)
        .limit(20000);

      if (uErr) {
        console.error(uErr);
        toast.error(uErr.message || "Failed to load units");
        return;
      }

      const relevantExpiryStatus = new Set(["IN_STOCK", "INVOICED", "DEMO"]);
      const expList: ExpiringUnitRow[] = [];

      // per-product counts
      const agg = new Map<string, ProductUnitAgg>();

      for (const u of (units ?? []) as any[]) {
        const productId = String(u.product_id);
        const prod = productMap.get(productId);
        if (!prod) continue;

        if (!agg.has(productId)) {
          agg.set(productId, {
            product_id: productId,
            product_name: prod.name,
            product_slug: prod.slug,
            in_stock: 0,
            invoiced: 0,
            demo: 0,
            sold: 0,
            returned: 0,
            total: 0,
            next_expiry_date: null,
            next_expiry_days_left: null,
          });
        }

        const a = agg.get(productId)!;

        a.total += 1;
        const st = String(u.status || "IN_STOCK");
        if (st === "IN_STOCK") a.in_stock += 1;
        else if (st === "INVOICED") a.invoiced += 1;
        else if (st === "DEMO") a.demo += 1;
        else if (st === "SOLD") a.sold += 1;
        else if (st === "RETURNED") a.returned += 1;

        const exp = u.expiry_date ? String(u.expiry_date).slice(0, 10) : null;
        if (!exp) continue;

        const dl = daysLeftFromYmd(exp);

        // next expiry only from IN_STOCK/INVOICED/DEMO
        if (relevantExpiryStatus.has(st)) {
          if (!a.next_expiry_date || exp < a.next_expiry_date) {
            a.next_expiry_date = exp;
            a.next_expiry_days_left = dl;
          }

          // build expiring list within window + also include expired
          if (exp <= endYmd) {
            expList.push({
              unit_id: String(u.id),
              unit_code: String(u.unit_code),
              product_id: productId,
              product_name: prod.name,
              product_slug: prod.slug,
              expiry_date: exp,
              days_left: dl,
              status: st as any,
            });
          }
        }
      }

      // Sort expiring: earliest expiry first
      expList.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
      setExpiringUnits(expList.slice(0, 25));

      // stats
      let totalUnits = 0;
      let inStockUnits = 0;
      let expiredUnits = 0;
      let expiringUnitsCount = 0;

      const lowStockThreshold = 5;
      let lowStockProducts = 0;
      let outOfStockProducts = 0;

      for (const a of agg.values()) {
        totalUnits += a.total;
        inStockUnits += a.in_stock;

        // product-level stock flags
        if (a.in_stock === 0) outOfStockProducts += 1;
        else if (a.in_stock > 0 && a.in_stock <= lowStockThreshold) lowStockProducts += 1;
      }

      // unit-level expiry counts (IN_STOCK/INVOICED/DEMO only)
      for (const e of expList) {
        if (e.expiry_date < todayYmd) expiredUnits += 1;
        else expiringUnitsCount += 1; // within window
      }

      setUnitStats({
        productsWithUnits: agg.size,
        totalUnits,
        inStockUnits,
        lowStockProducts,
        outOfStockProducts,
        expiringUnits: expiringUnitsCount,
        expiredUnits,
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
              {vendor.rejected_reason ? `Reason: ${vendor.rejected_reason}` : "Please contact support."}
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
            Expiry window: <b>{alertDays}</b> days (based on unit expiry)
          </p>
        </div>

        {/* Summary cards (UNIT SYSTEM) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Products (with Units)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{unitStats.productsWithUnits}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Total units: {unitStats.totalUnits}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Stock Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {unitStats.outOfStockProducts + unitStats.lowStockProducts}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Out: {unitStats.outOfStockProducts} • Low: {unitStats.lowStockProducts}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Expiring Units
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{unitStats.expiringUnits}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Within {alertDays} days
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Expired Units
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{unitStats.expiredUnits}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Already expired
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Expiring UNITS list */}
        <Card>
          <CardHeader>
            <CardTitle>Unit Expiry Alerts</CardTitle>
            <CardDescription>
              Units expiring within the next {alertDays} days (includes already expired). Sorted by expiry date.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-2">
            {expiringUnits.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No units expiring within the alert window.
              </div>
            ) : (
              expiringUnits.map((u) => (
                <div
                  key={u.unit_id}
                  className="flex items-center justify-between border rounded-md p-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{u.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      Unit: <span className="font-mono">{u.unit_code}</span> • Status: {u.status}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Expiry: {u.expiry_date}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${expiryClass(u.days_left, alertDays)}`}
                    >
                      {u.days_left < 0 ? `${Math.abs(u.days_left)}d expired` : `${u.days_left}d left`}
                    </span>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/vendor/products/${u.product_id}/units`)}
                    >
                      Open Units
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
                Add new products, update details, and manage pricing.
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
                View stock by units and upcoming unit expiry.
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
