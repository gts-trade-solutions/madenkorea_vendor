"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { useAuth } from "@/lib/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LogOut, Eye, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

type VendorOrderRow = {
  order_id: string;
  order_number: string;
  status: string;
  created_at: string;
  currency: string;
  vendor_total: number;
  item_qty: number;
  address_snapshot: any; // jsonb or stringified json; we'll parse safely
};

function safeParseSnapshot(snap: any): any {
  if (!snap) return null;
  if (typeof snap === "object") return snap;
  if (typeof snap === "string") {
    try {
      return JSON.parse(snap);
    } catch {
      return null;
    }
  }
  return null;
}

function formatMoney(v: number | null | undefined, currency?: string | null) {
  if (v == null) return "";
  const code = (currency ?? "INR").toUpperCase();
  if (code === "INR") return `₹${Number(v).toLocaleString("en-IN")}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(Number(v));
  } catch {
    return `${code} ${Number(v).toLocaleString()}`;
  }
}

function statusVariant(status: string) {
  const s = (status || "").toLowerCase();
  if (["delivered"].includes(s)) return "default";
  if (["shipped", "dispatched"].includes(s)) return "secondary";
  if (["cancelled"].includes(s)) return "destructive";
  return "outline";
}

export default function VendorOrdersPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<VendorOrderRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase.rpc("vendor_orders_list", {
      p_limit: 100,
      p_offset: 0,
    });

    if (error) {
      console.error("vendor_orders_list error", error);
      setRows([]);
      setErr(error.message || "Failed to load orders");
      setLoading(false);
      return;
    }

    setRows((data ?? []) as VendorOrderRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // VendorGate already ensures session + approved vendor
    // so we don’t re-check auth here.
  }, []);

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out successfully");
    router.push("/");
  };

  const mapped = useMemo(() => {
    return rows.map((r) => {
      const snap = safeParseSnapshot(r.address_snapshot);
      const customerName = snap?.name || snap?.full_name || snap?.customer_name || "";
      const customerPhone = snap?.phone || "";
      return { ...r, customerName, customerPhone };
    });
  }, [rows]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/vendor")}>
              ← Back
            </Button>
            <h1 className="text-2xl font-bold">Order Management</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
            <CardDescription>Orders that include your products</CardDescription>
          </CardHeader>

          <CardContent>
            {err ? (
              <div className="text-sm text-destructive">{err}</div>
            ) : null}

            {loading ? (
              <div className="text-center py-12 text-muted-foreground">Loading…</div>
            ) : mapped.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No orders yet</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Vendor Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {mapped.map((o) => (
                      <TableRow key={o.order_id}>
                        <TableCell className="font-medium">{o.order_number}</TableCell>

                        <TableCell>
                          <div className="text-sm">
                            {o.customerName || <span className="text-muted-foreground">—</span>}
                          </div>
                          {o.customerPhone ? (
                            <div className="text-xs text-muted-foreground">{o.customerPhone}</div>
                          ) : null}
                        </TableCell>

                        <TableCell>
                          {o.created_at
                            ? new Date(o.created_at).toLocaleDateString("en-IN", {
                                year: "numeric",
                                month: "short",
                                day: "2-digit",
                              })
                            : "—"}
                        </TableCell>

                        <TableCell>{Number(o.item_qty ?? 0).toLocaleString()}</TableCell>

                        <TableCell>{formatMoney(Number(o.vendor_total ?? 0), o.currency)}</TableCell>

                        <TableCell>
                          <Badge variant={statusVariant(o.status) as any}>{o.status}</Badge>
                        </TableCell>

                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/vendor/orders/${o.order_id}`)}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
