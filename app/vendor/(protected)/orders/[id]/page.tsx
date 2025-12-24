"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { useAuth } from "@/lib/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { LogOut, Printer, Package, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

type VendorOrderDetail = {
  order_id: string;
  order_number: string;
  status: string;
  created_at: string;
  currency: string;
  address_snapshot: any;
  vendor_subtotal: number;
  items: Array<{
    product_id: string | null;
    sku: string | null;
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    mrp?: number | null;
    hero_image_path?: string | null;
  }>;
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

export default function VendorOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user, logout } = useAuth();
  const orderId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<VendorOrderDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Keeping your dispatch UI but not writing to DB yet (no tracking columns defined)
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");

  const load = async () => {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase.rpc("vendor_order_detail", {
      p_order_id: orderId,
    });

    if (error) {
      console.error("vendor_order_detail error", error);
      setDetail(null);
      setErr(error.message || "Failed to load order");
      setLoading(false);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.order_id) {
      setDetail(null);
      setErr("Order not found (or does not include your products)");
      setLoading(false);
      return;
    }

    setDetail({
      order_id: row.order_id,
      order_number: row.order_number,
      status: row.status,
      created_at: row.created_at,
      currency: row.currency,
      address_snapshot: safeParseSnapshot(row.address_snapshot),
      vendor_subtotal: Number(row.vendor_subtotal ?? 0),
      items: Array.isArray(row.items) ? row.items : (row.items ? JSON.parse(row.items) : []),
    });

    setLoading(false);
  };

  useEffect(() => {
    if (!orderId) return;
    load();
  }, [orderId]);

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out successfully");
    router.push("/");
  };

  const handleMarkDispatched = () => {
    if (!trackingNumber || !carrier) {
      toast.error("Please enter tracking number and select carrier");
      return;
    }
    // Not writing to DB in Step 5.4 (we’ll add fulfillment table/columns later)
    toast.info("Dispatch update will be enabled in the next step (DB fulfillment fields).");
  };

  const handlePrintInvoice = () => {
    toast.info("Vendor invoice printing will be enabled after payout/commission rules are finalized.");
  };

  const handlePrintLabel = () => {
    toast.info("Shipping label printing will be enabled after carrier integration.");
  };

  const ship = detail?.address_snapshot || null;

  const itemCount = useMemo(() => {
    return (detail?.items ?? []).reduce((a, i) => a + (Number(i.quantity) || 0), 0);
  }, [detail?.items]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/vendor/orders")}>
              ← Back
            </Button>
            <h1 className="text-2xl font-bold">
              Order {detail?.order_number ? `#${detail.order_number}` : `#${orderId.slice(0, 8)}`}
            </h1>
            {detail?.status ? (
              <Badge variant={statusVariant(detail.status) as any}>{detail.status}</Badge>
            ) : null}
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
        {err ? <div className="mb-4 text-sm text-destructive">{err}</div> : null}

        {loading ? (
          <div className="py-16 text-center text-muted-foreground">Loading…</div>
        ) : !detail ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              Order not available.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Order Information</CardTitle>
                <CardDescription>Customer and order details (your items only)</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Placed On</div>
                    <div className="font-medium">
                      {new Date(detail.created_at).toLocaleString("en-IN")}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground">Items (your products)</div>
                    <div className="font-medium">{itemCount}</div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground">Vendor Subtotal</div>
                    <div className="font-medium">{formatMoney(detail.vendor_subtotal, detail.currency)}</div>
                  </div>
                </div>

                <div className="rounded-md border p-4">
                  <div className="text-sm font-medium mb-2">Shipping Snapshot</div>
                  {ship ? (
                    <div className="text-sm">
                      <div className="font-medium">{ship.name || "—"}</div>
                      <div>{ship.address || ship.line1 || "—"}</div>
                      <div>
                        {(ship.city || "—")}, {(ship.state || "—")} - {(ship.pincode || "—")}
                      </div>
                      <div className="text-muted-foreground">
                        {ship.phone || ""} {ship.email ? `· ${ship.email}` : ""}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No shipping snapshot available.</div>
                  )}
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit</TableHead>
                        <TableHead className="text-right">Line Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail.items ?? []).map((it, idx) => (
                        <TableRow key={`${it.product_id ?? "x"}-${idx}`}>
                          <TableCell>{it.sku || "—"}</TableCell>
                          <TableCell className="font-medium">{it.name}</TableCell>
                          <TableCell className="text-right">{Number(it.quantity ?? 0)}</TableCell>
                          <TableCell className="text-right">{formatMoney(Number(it.unit_price ?? 0), detail.currency)}</TableCell>
                          <TableCell className="text-right">{formatMoney(Number(it.line_total ?? 0), detail.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Dispatch Order</CardTitle>
                <CardDescription>Enter shipping information (DB write will be enabled next step)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="carrier">Shipping Carrier</Label>
                    <Select value={carrier} onValueChange={setCarrier}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select carrier" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="delhivery">Delhivery</SelectItem>
                        <SelectItem value="bluedart">Blue Dart</SelectItem>
                        <SelectItem value="dtdc">DTDC</SelectItem>
                        <SelectItem value="indiapost">India Post</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="tracking">Tracking Number</Label>
                    <Input
                      id="tracking"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="Enter tracking number"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleMarkDispatched} className="flex-1 min-w-[200px]">
                      <Package className="mr-2 h-4 w-4" />
                      Mark as Dispatched
                    </Button>
                    <Button variant="outline" onClick={handlePrintInvoice}>
                      <Printer className="mr-2 h-4 w-4" />
                      Print Invoice
                    </Button>
                    <Button variant="outline" onClick={handlePrintLabel}>
                      <Printer className="mr-2 h-4 w-4" />
                      Print Label
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
