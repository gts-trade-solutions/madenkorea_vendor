"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, Search, RefreshCcw, QrCode } from "lucide-react";
import { toast } from "sonner";

type VendorInfo = {
  id: string;
  display_name: string;
  status: "pending" | "approved" | "rejected" | "disabled";
};

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  price: number | null;
  currency: string | null;
  is_published: boolean;
  updated_at: string;
  vendor_id: string | null;
  brands?: { name?: string | null } | null;
};

type UnitSummary = {
  total: number;
  byStatus: Record<string, number>;
  expiredCount: number;
  expiringSoonCount: number;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

function coerceVendor(data: any): VendorInfo | null {
  const arr = Array.isArray(data) ? data : data ? [data] : [];
  const v = arr[0];
  if (!v) return null;
  return { id: v.id, display_name: v.display_name, status: v.status };
}

function formatINR(v?: number | null, currency?: string | null) {
  if (v == null) return "—";
  const code = (currency ?? "INR").toUpperCase();
  if (code === "INR") return `₹${v.toLocaleString("en-IN")}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(v);
  } catch {
    return `${code} ${v.toLocaleString()}`;
  }
}

function toYmd(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function addDaysYmd(baseYmd: string, days: number) {
  const d = new Date(baseYmd);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

function expiryPillClass(daysLeft: number, alertDays: number) {
  if (daysLeft < 0) return "bg-red-600 text-white";
  if (daysLeft <= 30) return "bg-red-500 text-white";
  if (daysLeft <= 90) return "bg-orange-500 text-white";
  if (daysLeft <= alertDays) return "bg-yellow-400 text-black";
  return "bg-muted text-foreground";
}

function useDebouncedCallback<T extends (...args: any[]) => void>(
  fn: T,
  delay = 500
) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (...args: Parameters<T>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fnRef.current(...args), delay);
  };
}

export default function VendorProductsPage() {
  const router = useRouter();

  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);

  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [unitSummary, setUnitSummary] = useState<Record<string, UnitSummary>>(
    {}
  );

  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState({ from: 0, to: 19, more: false });
  const [refreshKey, setRefreshKey] = useState(0);

  const [alertDays, setAlertDays] = useState<number>(180);

  // treat low stock based on IN_STOCK units
  const lowStockThreshold = 5;

  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const endYmd = useMemo(
    () => addDaysYmd(todayYmd, alertDays),
    [todayYmd, alertDays]
  );

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
        router.replace("/vendor");
        return;
      }

      const v = coerceVendor(data);
      if (!v) {
        router.replace("/vendor/register");
        return;
      }
      if (v.status !== "approved") {
        router.replace("/vendor");
        return;
      }

      setVendor(v);
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      setHydrated(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  // load vendor expiry_alert_days
  useEffect(() => {
    if (!vendor?.id) return;
    (async () => {
      const { data } = await supabase
        .from("vendors")
        .select("expiry_alert_days")
        .eq("id", vendor.id)
        .maybeSingle();

      const d = Number((data as any)?.expiry_alert_days ?? 180);
      setAlertDays(Number.isFinite(d) && d > 0 ? d : 180);
    })();
  }, [vendor?.id]);

  /**
   * ✅ Units summary by product, based purely on inventory_units
   * - total count
   * - byStatus count
   * - expired count (expiry_date < today)
   * - expiring soon count (today <= expiry_date <= today+alertDays)
   */
  const fetchUnitSummaryForProducts = async (productIds: string[]) => {
    if (!vendor?.id) return;
    const missing = productIds.filter((id) => !unitSummary[id]);
    if (missing.length === 0) return;

    const { data, error } = await supabase
      .from("inventory_units")
      .select("product_id,status,expiry_date")
      .eq("vendor_id", vendor.id)
      .in("product_id", missing);

    if (error) {
      console.warn("unit summary fetch error", error);
      return;
    }

    const next: Record<string, UnitSummary> = {};
    for (const pid of missing) {
      next[pid] = {
        total: 0,
        byStatus: {},
        expiredCount: 0,
        expiringSoonCount: 0,
      };
    }

    for (const row of (data ?? []) as any[]) {
      const pid = String(row.product_id);
      const st = String(row.status || "IN_STOCK");
      const exp = row.expiry_date ? String(row.expiry_date).slice(0, 10) : null;

      if (!next[pid])
        next[pid] = {
          total: 0,
          byStatus: {},
          expiredCount: 0,
          expiringSoonCount: 0,
        };

      next[pid].total += 1;
      next[pid].byStatus[st] = (next[pid].byStatus[st] || 0) + 1;

      if (exp) {
        if (exp < todayYmd) next[pid].expiredCount += 1;
        else if (exp >= todayYmd && exp <= endYmd)
          next[pid].expiringSoonCount += 1;
      }
    }

    setUnitSummary((prev) => ({ ...prev, ...next }));
  };

  const loadPage = async (reset = false) => {
    if (!vendor) return;
    setLoading(true);

    const from = reset ? 0 : paging.from;
    const to = reset ? 19 : paging.to;

    const { data, error } = await supabase
      .from("products")
      .select(
        `
        id, slug, name, price, currency, is_published, updated_at, vendor_id,
        brands ( name )
      `
      )
      .eq("vendor_id", vendor.id)
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (error) {
      toast.error(error.message || "Failed to load products");
      setRows([]);
      setPaging({ from: 0, to: 19, more: false });
    } else {
      const got = (data ?? []) as ProductRow[];
      if (reset) setUnitSummary({});
      setRows((prev) => (reset ? got : from === 0 ? got : [...prev, ...got]));
      fetchUnitSummaryForProducts(got.map((p) => p.id));
      const more = got.length >= to - from + 1;
      setPaging({
        from: reset ? 20 : to + 1,
        to: reset ? 39 : to + 20,
        more,
      });
    }

    setLoading(false);
  };

  useEffect(() => {
    if (!ready || !vendor) return;
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, vendor, refreshKey, alertDays]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        (r.brands?.name || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const onDelete = async (id: string) => {
    const yes = window.confirm("Delete this product? This cannot be undone.");
    if (!yes) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      toast.error(error.message || "Delete failed");
      return;
    }
    toast.success("Product deleted");
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const togglePublish = async (id: string, next: boolean) => {
    const old = rows.find((r) => r.id === id)?.is_published;

    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_published: next } : r))
    );

    const { error } = await supabase
      .from("products")
      .update({ is_published: next })
      .eq("id", id);

    if (error) {
      toast.error(error.message || "Failed to update visibility");
      if (typeof old === "boolean") {
        setRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, is_published: old } : r))
        );
      } else {
        setRefreshKey((k) => k + 1);
      }
    } else {
      toast.success(next ? "Product published" : "Product hidden");
    }
  };

  // Debounced refresh (for search -> if you want later; currently local filter only)
  const refresh = useDebouncedCallback(() => setRefreshKey((k) => k + 1), 250);

  if (!hydrated || !ready) {
    return (
      <div className="container mx-auto py-16 text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/vendor")}>
              ← Back
            </Button>
            <h1 className="text-2xl font-bold">Product Management</h1>
            <Badge>Vendor: {vendor?.display_name}</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              <RefreshCcw className="h-4 w-4 mr-2" />
              Refresh
            </Button>

            <Button onClick={() => router.push("/vendor/products/single-new")}>
              <Plus className="mr-2 h-4 w-4" />
              Add Single Product
            </Button>

            <Button onClick={() => router.push("/vendor/products/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Add Bulk Product
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
                <div>
                  <CardTitle>Products</CardTitle>
                  <CardDescription>
                    Inventory is fully managed by Units (batch + unit status +
                    expiry).
                  </CardDescription>
                </div>

                <div className="w-full md:w-[560px] flex items-center gap-3">
                  <div className="relative w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search products…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        refresh();
                      }}
                      className="pl-10"
                    />
                  </div>

                  <div className="text-sm whitespace-nowrap">
                    Expiry window: <b>{alertDays}</b> days
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[320px]">Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>MRP</TableHead>

                    {/* ✅ Units-based stock/expiry summary */}
                    <TableHead className="min-w-[300px]">
                      Units Summary
                    </TableHead>

                    <TableHead className="min-w-[180px]">Published</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground py-10"
                      >
                        {loading ? "Loading…" : "No products found"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((p) => {
                      const s = unitSummary[p.id];
                      const total = s?.total ?? 0;
                      const inStock = s?.byStatus?.IN_STOCK ?? 0;
                      const invoiced = s?.byStatus?.INVOICED ?? 0;
                      const demo = s?.byStatus?.DEMO ?? 0;
                      const sold = s?.byStatus?.SOLD ?? 0;
                      const returned = s?.byStatus?.RETURNED ?? 0;

                      const expired = s?.expiredCount ?? 0;
                      const expSoon = s?.expiringSoonCount ?? 0;

                      const lowStock =
                        inStock > 0 && inStock <= lowStockThreshold;

                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            <div className="line-clamp-2">{p.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.slug}
                            </div>
                          </TableCell>

                          <TableCell>{p.brands?.name ?? "—"}</TableCell>

                          <TableCell>
                            {formatINR(p.price, p.currency)}
                          </TableCell>

                          <TableCell>
                            <div className="flex flex-wrap gap-2 items-center">
                              <Badge variant="secondary">
                                Total: <b className="ml-1">{total}</b>
                              </Badge>

                              <Badge
                                className={
                                  lowStock ? "bg-orange-500 text-white" : ""
                                }
                              >
                                In stock: <b className="ml-1">{inStock}</b>
                              </Badge>

                              <Badge variant="outline">
                                Invoiced: <b className="ml-1">{invoiced}</b>
                              </Badge>

                              <Badge variant="outline">
                                Demo: <b className="ml-1">{demo}</b>
                              </Badge>

                              <Badge variant="outline">
                                Sold: <b className="ml-1">{sold}</b>
                              </Badge>

                              <Badge variant="outline">
                                Returned: <b className="ml-1">{returned}</b>
                              </Badge>

                              {expired > 0 ? (
                                <span className="text-xs px-2 py-1 rounded bg-red-600 text-white">
                                  {expired} expired
                                </span>
                              ) : null}

                              {expSoon > 0 ? (
                                <span
                                  className={`text-xs px-2 py-1 rounded ${expiryPillClass(
                                    1,
                                    alertDays
                                  )}`}
                                  title={`Expiring within ${alertDays} days`}
                                >
                                  {expSoon} expiring soon
                                </span>
                              ) : null}

                              {total === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  No units added yet
                                </span>
                              ) : null}
                            </div>

                            {lowStock ? (
                              <div className="mt-1 text-xs text-orange-600">
                                Low stock (≤ {lowStockThreshold} in stock)
                              </div>
                            ) : null}
                          </TableCell>

                          {/* Published */}
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={p.is_published}
                                onCheckedChange={(v) => togglePublish(p.id, v)}
                                aria-label="Publish / hide"
                              />
                              <Badge
                                variant={
                                  p.is_published ? "default" : "secondary"
                                }
                              >
                                {p.is_published ? "Published" : "Hidden"}
                              </Badge>
                            </div>
                          </TableCell>

                          <TableCell className="whitespace-nowrap text-sm">
                            {new Date(p.updated_at).toLocaleDateString(
                              "en-IN",
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              }
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  router.push(`/vendor/products/${p.id}/units`)
                                }
                                title="Manage Units"
                              >
                                <QrCode className="h-4 w-4" />
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  router.push(`/vendor/products/${p.id}`)
                                }
                                title="Edit"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onDelete(p.id)}
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 flex justify-center">
              {paging.more && (
                <Button
                  variant="outline"
                  onClick={() => loadPage(false)}
                  disabled={loading}
                >
                  {loading ? "Loading…" : "Load More"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
