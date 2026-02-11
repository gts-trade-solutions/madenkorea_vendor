"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";

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
import {
  Plus,
  Edit,
  Trash2,
  Search,
  RefreshCcw,
  QrCode,
  X,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type VendorInfo = {
  id: string;
  display_name: string;
  status: "pending" | "approved" | "rejected" | "disabled";
};

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  sale_price: number | null;
  currency: string | null;
  is_published: boolean;
  updated_at: string;
  vendor_id: string | null;
  brand_id?: string | null;
  brands?: { name?: string | null } | null;
};




type BrandOption = { id: string; name: string };

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

function useDebouncedValue<T>(value: T, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function VendorProductsPage() {
  const router = useRouter();

  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);

  // server-side search + filters
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 350);

  const [brandId, setBrandId] = useState<string | "ALL">("ALL");
  const [published, setPublished] = useState<"ALL" | "PUBLISHED" | "HIDDEN">(
    "ALL"
  );
  const [sort, setSort] = useState<"UPDATED_DESC" | "NAME_ASC">("UPDATED_DESC");

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  // unit summary cache (per product id)
  const [unitSummary, setUnitSummary] = useState<Record<string, UnitSummary>>(
    {}
  );

  const [brands, setBrands] = useState<BrandOption[]>([]);

  const [refreshKey, setRefreshKey] = useState(0);

  // expiry window
  const [alertDays, setAlertDays] = useState<number>(180);
  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const endYmd = useMemo(
    () => addDaysYmd(todayYmd, alertDays),
    [todayYmd, alertDays]
  );

  // low stock flag based on IN_STOCK units
  const lowStockThreshold = 5;

// ✅ Find product_ids by searching inventory_units (supports different column names safely)
const findProductIdsByUnitSearch = async (term: string) => {
  if (!vendor?.id) return [];

  const s = term.trim();
  if (!s) return [];

  const like = `%${s}%`;

  // Try common column names one-by-one.
  // If a column doesn't exist in your DB, Supabase returns an error — we ignore and continue.
  const candidateCols = ["unit_code", "barcode", "qr_code", "serial_no"];

  const out = new Set<string>();

  for (const col of candidateCols) {
    const { data, error } = await supabase
      .from("inventory_units")
      .select("product_id")
      .eq("vendor_id", vendor.id)

      .ilike(col as any, like)
      .limit(500);

    if (error) continue;

    (data ?? []).forEach((r: any) => {
      if (r?.product_id) out.add(String(r.product_id));
    });
  }

  return Array.from(out);
};


  // ---------------- auth / vendor gate ----------------
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
      sub?.subscription?.unsubscribe();
    };
  }, [router]);

  // vendor expiry alert days
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

  // load brand options (filter dropdown)
  useEffect(() => {
    if (!vendor?.id) return;
    (async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id,name")
        .order("name", { ascending: true });

      if (error) {
        console.warn("brands load error", error);
        setBrands([]);
      } else {
        setBrands(((data ?? []) as any[]).map((b) => ({ id: b.id, name: b.name })));
      }
    })();
  }, [vendor?.id]);

  /**
   * Units summary for products (current page only).
   * If your units table is huge, move this to an RPC/view with aggregates.
   */
const fetchUnitSummaryForProducts = async (productIds: string[]) => {
  if (!vendor?.id) return;

  const missing = productIds.filter((id) => !unitSummary[id]);
  if (missing.length === 0) return;

  const next: Record<string, UnitSummary> = {};
  for (const pid of missing) {
    next[pid] = { total: 0, byStatus: {}, expiredCount: 0, expiringSoonCount: 0 };
  }

  const step = 1000; // page size
  let from = 0;

  while (true) {
    const to = from + step - 1;

    const { data, error } = await supabase
      .from("inventory_units")
      .select("product_id,status,expiry_date")
      .eq("vendor_id", vendor.id)
      .in("product_id", missing)
      .range(from, to);

    if (error) {
      console.warn("unit summary fetch error", error);
      return;
    }

    const rows = (data ?? []) as any[];

    for (const row of rows) {
      const pid = String(row.product_id);
      const st = String(row.status || "IN_STOCK");
      const exp = row.expiry_date ? String(row.expiry_date).slice(0, 10) : null;

      if (!next[pid]) {
        next[pid] = { total: 0, byStatus: {}, expiredCount: 0, expiringSoonCount: 0 };
      }

      next[pid].total += 1;
      next[pid].byStatus[st] = (next[pid].byStatus[st] || 0) + 1;

      if (exp) {
        if (exp < todayYmd) next[pid].expiredCount += 1;
        else if (exp >= todayYmd && exp <= endYmd) next[pid].expiringSoonCount += 1;
      }
    }

    // stop when this page returned fewer than step rows
    if (rows.length < step) break;

    from += step;
  }

  setUnitSummary((prev) => ({ ...prev, ...next }));
};


  // ---------------- main fetch (server-side search/pagination) ----------------
  const fetchProducts = async (opts?: { resetPage?: boolean; clearSummary?: boolean }) => {
    if (!vendor?.id) return;

    const resetPage = opts?.resetPage ?? false;
    const clearSummary = opts?.clearSummary ?? false;

    const targetPage = resetPage ? 1 : page;
    const from = (targetPage - 1) * pageSize;
    const to = from + pageSize - 1;

    setLoading(true);
    try {
      let q = supabase
        .from("products")
        .select(
          `
          id, slug, name, sale_price, currency, is_published, updated_at, vendor_id, brand_id,
          brands ( name )
        `,
          { count: "exact" }
        )
        .eq("vendor_id", vendor.id);

      const s = debouncedSearch.trim();
if (s) {
  // ✅ search products by name/slug OR by matching units (barcode/unit_code/etc.)
  const unitProductIds = await findProductIdsByUnitSearch(s);

  if (unitProductIds.length > 0) {
    // PostgREST "in" syntax needs parentheses
    const inList = unitProductIds.join(",");
    q = q.or(`name.ilike.%${s}%,slug.ilike.%${s}%,id.in.(${inList})`);
  } else {
    q = q.or(`name.ilike.%${s}%,slug.ilike.%${s}%`);
  }
}

      if (brandId !== "ALL") {
        q = q.eq("brand_id", brandId);
      }

      if (published !== "ALL") {
        q = q.eq("is_published", published === "PUBLISHED");
      }

      if (sort === "UPDATED_DESC") {
        q = q.order("updated_at", { ascending: false });
      } else {
        q = q.order("name", { ascending: true });
      }

      const { data, error, count } = await q.range(from, to);

      if (error) {
        toast.error(error.message || "Failed to load products");
        setRows([]);
        setTotalCount(0);
        return;
      }

      if (clearSummary) setUnitSummary({});
      const got = (data ?? []) as ProductRow[];
      setRows(got);
      setTotalCount(count ?? 0);

      // Fetch unit summary for just this page’s products
      fetchUnitSummaryForProducts(got.map((p) => p.id));

      if (resetPage) setPage(1);
    } finally {
      setLoading(false);
    }
  };

  // first load + refresh + filters/search/page changes
  useEffect(() => {
    if (!ready || !vendor?.id) return;
    fetchProducts({ resetPage: false, clearSummary: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, vendor?.id, page, pageSize, debouncedSearch, brandId, published, sort, refreshKey, alertDays]);

  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / pageSize));

  const clearFilters = () => {
    setSearch("");
    setBrandId("ALL");
    setPublished("ALL");
    setSort("UPDATED_DESC");
    setPage(1);
    setUnitSummary({});
    setRefreshKey((k) => k + 1);
  };

  const onDelete = async (id: string) => {
    const yes = window.confirm("Delete this product? This cannot be undone.");
    if (!yes) return;

    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      toast.error(error.message || "Delete failed");
      return;
    }

    toast.success("Product deleted");
    // Refresh current page
    setUnitSummary((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRefreshKey((k) => k + 1);
  };

  const togglePublish = async (id: string, next: boolean) => {
    const old = rows.find((r) => r.id === id)?.is_published;

    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_published: next } : r)));

    const { error } = await supabase.from("products").update({ is_published: next }).eq("id", id);

    if (error) {
      toast.error(error.message || "Failed to update visibility");
      if (typeof old === "boolean") {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_published: old } : r)));
      } else {
        setRefreshKey((k) => k + 1);
      }
    } else {
      toast.success(next ? "Product published" : "Product hidden");
    }
  };

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
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
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
                    Inventory is fully managed by Units (batch + unit status + expiry).
                  </CardDescription>
                </div>

                <div className="w-full md:w-[760px] flex flex-col md:flex-row md:items-center gap-3">
                  {/* Search */}
                  <div className="relative w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by product name or slug…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                        setUnitSummary({});
                      }}
                      className="pl-10"
                    />
                  </div>

                  {/* Brand filter */}
                  <Select
                    value={brandId}
                    onValueChange={(v) => {
                      setBrandId(v as any);
                      setPage(1);
                      setUnitSummary({});
                    }}
                  >
                    <SelectTrigger className="w-full md:w-[220px]">
                      <SelectValue placeholder="Brand" />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      <SelectItem value="ALL">All brands</SelectItem>
                      {brands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Published filter */}
                  <Select
                    value={published}
                    onValueChange={(v) => {
                      setPublished(v as any);
                      setPage(1);
                      setUnitSummary({});
                    }}
                  >
                    <SelectTrigger className="w-full md:w-[180px]">
                      <SelectValue placeholder="Visibility" />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      <SelectItem value="ALL">All</SelectItem>
                      <SelectItem value="PUBLISHED">Published</SelectItem>
                      <SelectItem value="HIDDEN">Hidden</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Sort */}
                  <Select
                    value={sort}
                    onValueChange={(v) => {
                      setSort(v as any);
                      setPage(1);
                      setUnitSummary({});
                    }}
                  >
                    <SelectTrigger className="w-full md:w-[200px]">
                      <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      <SelectItem value="UPDATED_DESC">Updated (newest)</SelectItem>
                      <SelectItem value="NAME_ASC">Name (A→Z)</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Clear */}
                  <Button variant="outline" onClick={clearFilters} className="whitespace-nowrap">
                    <X className="h-4 w-4 mr-2" />
                    Clear
                  </Button>
                </div>
              </div>

              {/* Secondary row: pagination info */}
              <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
                <div className="text-sm text-muted-foreground">
                  Results: <b>{totalCount}</b> • Page <b>{page}</b> / <b>{totalPages}</b> • Expiry window:{" "}
                  <b>{alertDays}</b> days
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-sm text-muted-foreground">Page size</div>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      setPage(1);
                      setUnitSummary({});
                    }}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
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
                    {/* <TableHead>MRP</TableHead> */}
                    <TableHead className="min-w-[340px]">Units Summary</TableHead>
                    <TableHead className="min-w-[220px] text-center">Published</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                        {loading ? "Loading…" : "No products found"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((p) => {
                      const s = unitSummary[p.id];
                      const total = s?.total ?? 0;
                      const inStock = s?.byStatus?.IN_STOCK ?? 0;
                      const invoiced = s?.byStatus?.INVOICED ?? 0;
                      const demo = s?.byStatus?.DEMO ?? 0;
                      const sold = s?.byStatus?.SOLD ?? 0;
                      const returned = s?.byStatus?.RETURNED ?? 0;

                      const expired = s?.expiredCount ?? 0;
                      const expSoon = s?.expiringSoonCount ?? 0;

                      const lowStock = inStock > 0 && inStock <= lowStockThreshold;

                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            <div className="line-clamp-2">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.slug}</div>
                          </TableCell>

                          <TableCell>{p.brands?.name ?? "—"}</TableCell>

                          {/* <TableCell>{formatINR(p.sale_price, p.currency)}</TableCell> */}

                          <TableCell>
                            <div className="flex flex-wrap gap-2 items-center">
                              <Badge variant="secondary">
                                Total: <b className="ml-1">{total}</b>
                              </Badge>

                              <Badge className={lowStock ? "bg-orange-500 text-white" : ""}>
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
                                  className="text-xs px-2 py-1 rounded bg-yellow-400 text-black"
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

                         <TableCell className="whitespace-nowrap">
  <div className="flex items-center justify-center gap-3">
    <Switch
      className="shrink-0"
      checked={p.is_published}
      onCheckedChange={(v) => togglePublish(p.id, v)}
      aria-label="Publish / hide"
    />
    <Badge
      className="shrink-0"
      variant={p.is_published ? "default" : "secondary"}
    >
      {p.is_published ? "Published" : "Hidden"}
    </Badge>
  </div>
</TableCell>


                          <TableCell className="whitespace-nowrap text-sm">
                            {new Date(p.updated_at).toLocaleDateString("en-IN", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => router.push(`/vendor/products/${p.id}/units`)}
                                title="Manage Units"
                              >
                                <QrCode className="h-4 w-4" />
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => router.push(`/vendor/products/${p.id}`)}
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

            {/* Bottom pagination */}
            <div className="mt-4 flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                Showing page <b>{page}</b> of <b>{totalPages}</b> • Total <b>{totalCount}</b>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
