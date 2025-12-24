"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, ArrowLeft, Package, AlertTriangle, ShieldAlert, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

type AlertRow = {
  alert_type: "expired" | "expiring_soon" | "out_of_stock" | "low_stock";
  severity: number;
  product_id: string;
  sku: string | null;
  name: string;
  stock_qty: number | null;
  expiry_date: string | null; // date
  days_left: number | null;
};

function badgeVariantForType(t: AlertRow["alert_type"]) {
  if (t === "expired") return "destructive";
  if (t === "expiring_soon") return "secondary";
  if (t === "out_of_stock") return "destructive";
  return "outline"; // low_stock
}

function iconForType(t: AlertRow["alert_type"]) {
  if (t === "expired" || t === "expiring_soon") return <ShieldAlert className="h-4 w-4" />;
  return <AlertTriangle className="h-4 w-4" />;
}

function labelForType(t: AlertRow["alert_type"]) {
  switch (t) {
    case "expired":
      return "Expired";
    case "expiring_soon":
      return "Expiring soon";
    case "out_of_stock":
      return "Out of stock";
    case "low_stock":
      return "Low stock";
    default:
      return t;
  }
}

export default function VendorAlertsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase.rpc("vendor_alerts_list", {
      p_limit: 200,
      p_offset: 0,
    });

    if (error) {
      console.error("vendor_alerts_list error", error);
      setRows([]);
      setErr(error.message || "Failed to load alerts");
      setLoading(false);
      return;
    }

    setRows((data ?? []) as AlertRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    const c = { expired: 0, expiring_soon: 0, out_of_stock: 0, low_stock: 0, all: 0 };
    for (const r of rows) {
      c.all += 1;
      (c as any)[r.alert_type] += 1;
    }
    return c;
  }, [rows]);

  const group = useMemo(() => {
    const by: Record<string, AlertRow[]> = { all: rows, expired: [], expiring_soon: [], out_of_stock: [], low_stock: [] };
    for (const r of rows) by[r.alert_type].push(r);
    return by;
  }, [rows]);

  const renderTable = (list: AlertRow[]) => {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[260px]">Product</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="text-right">Days left</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No alerts
                </TableCell>
              </TableRow>
            ) : (
              list.map((r) => (
                <TableRow key={`${r.alert_type}-${r.product_id}`}>
                  <TableCell className="font-medium">
                    <div className="line-clamp-2">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.product_id.slice(0, 8)}…</div>
                  </TableCell>

                  <TableCell>
                    <Badge variant={badgeVariantForType(r.alert_type) as any} className="gap-2">
                      {iconForType(r.alert_type)}
                      {labelForType(r.alert_type)}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-sm">{r.sku ?? "—"}</TableCell>

                  <TableCell className="text-right">{(r.stock_qty ?? 0).toLocaleString()}</TableCell>

                  <TableCell className="text-sm">
                    {r.expiry_date ? String(r.expiry_date).slice(0, 10) : "—"}
                  </TableCell>

                  <TableCell className="text-right text-sm">
                    {r.days_left == null ? "—" : r.days_left < 0 ? `${Math.abs(r.days_left)}d ago` : `${r.days_left}d`}
                  </TableCell>

                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/vendor/products/${r.product_id}`)}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/vendor")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">Alerts</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Inventory & Expiry Alerts
            </CardTitle>
            <CardDescription>
              Alerts are generated from your products stock and expiry date.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {err ? <div className="text-sm text-destructive mb-3">{err}</div> : null}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <Card>
                <CardContent className="py-4">
                  <div className="text-xs text-muted-foreground">All</div>
                  <div className="text-2xl font-bold">{loading ? "…" : counts.all}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="text-xs text-muted-foreground">Expired</div>
                  <div className="text-2xl font-bold">{loading ? "…" : counts.expired}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="text-xs text-muted-foreground">Expiring soon</div>
                  <div className="text-2xl font-bold">{loading ? "…" : counts.expiring_soon}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="text-xs text-muted-foreground">Out of stock</div>
                  <div className="text-2xl font-bold">{loading ? "…" : counts.out_of_stock}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <div className="text-xs text-muted-foreground">Low stock</div>
                  <div className="text-2xl font-bold">{loading ? "…" : counts.low_stock}</div>
                </CardContent>
              </Card>
            </div>

            <Tabs defaultValue="all">
              <TabsList className="flex flex-wrap">
                <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                <TabsTrigger value="expired">Expired ({counts.expired})</TabsTrigger>
                <TabsTrigger value="expiring_soon">Expiring ({counts.expiring_soon})</TabsTrigger>
                <TabsTrigger value="out_of_stock">Out of stock ({counts.out_of_stock})</TabsTrigger>
                <TabsTrigger value="low_stock">Low stock ({counts.low_stock})</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(group.all)}
              </TabsContent>
              <TabsContent value="expired" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(group.expired)}
              </TabsContent>
              <TabsContent value="expiring_soon" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(group.expiring_soon)}
              </TabsContent>
              <TabsContent value="out_of_stock" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(group.out_of_stock)}
              </TabsContent>
              <TabsContent value="low_stock" className="mt-4">
                {loading ? <div className="py-10 text-center text-muted-foreground">Loading…</div> : renderTable(group.low_stock)}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
