"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  UnitStatusBadge,
  type InventoryStatus,
} from "@/components/inventory/UnitStatusBadge";

import { UnitUpsertDialog } from "./UnitUpsert";

type VendorInfo = {
  id: string;
  display_name: string;
  status: "pending" | "approved" | "rejected" | "disabled";
};

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  vendor_id: string;
  product_code: string | null;
  brand_id: string | null;
  price: number | null; // MRP
};

type BrandRow = {
  id: string;
  name: string;
  brand_code: string | null;
};

type UnitRow = {
  id: string;
  unit_code: string;
  manufacture_date: string;
  expiry_date: string | null;
  status: InventoryStatus;
  created_at: string;

  // SOLD snapshot fields (optional UI display)
  sold_customer_name?: string | null;
  sold_customer_phone?: string | null;
};

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

function toYmd(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function ProductUnitsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const productId = params.id;

  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [brand, setBrand] = useState<BrandRow | null>(null);

  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);

  // pagination
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [totalCount, setTotalCount] = useState(0);

  // filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InventoryStatus | "ALL">("ALL");

  // dialogs
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<UnitRow | null>(null);

  // row update
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // export
  const [exporting, setExporting] = useState(false);

  const todayYmd = useMemo(() => toYmd(new Date()), []);

  // ---------------- SOLD customer dialog state ----------------
  const [soldDialogOpen, setSoldDialogOpen] = useState(false);
  const [soldTargetUnit, setSoldTargetUnit] = useState<UnitRow | null>(null);

  const [custQuery, setCustQuery] = useState("");
  const [custLoading, setCustLoading] = useState(false);
  const [custSuggestions, setCustSuggestions] = useState<CustomerRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custAddress, setCustAddress] = useState("");

  const resetSoldForm = () => {
    setCustQuery("");
    setCustSuggestions([]);
    setSelectedCustomerId(null);

    setCustName("");
    setCustPhone("");
    setCustEmail("");
    setCustAddress("");
  };

  const openSoldDialog = (u: UnitRow) => {
    setSoldTargetUnit(u);
    resetSoldForm();

    // If unit already has sold info, prefill (helpful for editing)
    if (u.sold_customer_name) setCustName(u.sold_customer_name ?? "");
    if (u.sold_customer_phone) setCustPhone(u.sold_customer_phone ?? "");

    setSoldDialogOpen(true);
  };

  // ---------------- Auth + vendor ----------------
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
        router.replace("/vendor");
        return;
      }

      const arr = Array.isArray(data) ? data : data ? [data] : [];
      const v = arr[0] as VendorInfo | undefined;

      if (!v || v.status !== "approved") {
        router.replace("/vendor");
        return;
      }

      setVendor(v);
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => setHydrated(true));

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, [router]);

  // -------- Load product + brand (once) --------
  useEffect(() => {
    if (!ready || !vendor?.id) return;
    let cancelled = false;

    (async () => {
      const { data: p, error: pErr } = await supabase
        .from("products")
        .select("id,name,slug,vendor_id,product_code,brand_id,price")
        .eq("id", productId)
        .eq("vendor_id", vendor.id)
        .single();

      if (cancelled) return;

      if (pErr) {
        toast.error(pErr.message || "Failed to load product");
        return;
      }

      setProduct(p as any);

      const bId = (p as any)?.brand_id as string | null;
      if (bId) {
        const { data: b, error: bErr } = await supabase
          .from("brands")
          .select("id,name,brand_code")
          .eq("id", bId)
          .maybeSingle();

        if (!cancelled) {
          if (bErr) setBrand(null);
          else setBrand((b ?? null) as any);
        }
      } else {
        setBrand(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, vendor?.id, productId]);

  // -------- Fetch units (server-side pagination + filters) --------
  const fetchUnits = async () => {
    if (!vendor?.id) return;

    setLoading(true);
    try {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let q = supabase
        .from("inventory_units")
        .select(
          "id,unit_code,manufacture_date,expiry_date,status,created_at,sold_customer_name,sold_customer_phone",
          { count: "exact" }
        )
        .eq("vendor_id", vendor.id)
        .eq("product_id", productId);

      if (statusFilter !== "ALL") q = q.eq("status", statusFilter);

      const s = search.trim();
      if (s) q = q.ilike("unit_code", `%${s}%`);

      const { data, error, count } = await q
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) {
        toast.error(error.message || "Failed to load units");
        setUnits([]);
        setTotalCount(0);
      } else {
        setUnits((data ?? []) as any);
        setTotalCount(count ?? 0);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !vendor?.id) return;
    fetchUnits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, vendor?.id, productId, page, statusFilter]);

  useEffect(() => {
    if (!ready || !vendor?.id) return;
    const t = setTimeout(() => {
      setPage(1);
      fetchUnits();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const countsThisPage = useMemo(() => {
    const out: Record<InventoryStatus, number> = {
      IN_STOCK: 0,
      INVOICED: 0,
      DEMO: 0,
      SOLD: 0,
      RETURNED: 0,
      OUT_OF_STOCK: 0,
    };
    for (const u of units) out[u.status] = (out[u.status] || 0) + 1;
    return out;
  }, [units]);

  const expiredCountThisPage = useMemo(() => {
    let n = 0;
    for (const u of units) {
      const exp = u.expiry_date ? String(u.expiry_date).slice(0, 10) : null;
      if (exp && exp < todayYmd) n += 1;
    }
    return n;
  }, [units, todayYmd]);

  const openEdit = (u: UnitRow) => {
    setEditUnit(u);
    setEditOpen(true);
  };

  const deleteUnit = async (u: UnitRow) => {
    if (!vendor?.id) return;

    const yes = confirm(`Delete unit ${u.unit_code}?`);
    if (!yes) return;

    const { error } = await supabase
      .from("inventory_units")
      .delete()
      .eq("id", u.id)
      .eq("vendor_id", vendor.id);

    if (error) {
      toast.error(error.message || "Delete failed");
      return;
    }

    toast.success("Unit deleted");
    fetchUnits();
  };

  // ---------------- Status updates ----------------
  const updateStatusDirect = async (u: UnitRow, next: InventoryStatus) => {
    if (!vendor?.id) return;
    if (u.status === next) return;

    setUpdatingId(u.id);

    // optimistic
    setUnits((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: next } : x)));

    const { error } = await supabase
      .from("inventory_units")
      .update({ status: next })
      .eq("id", u.id)
      .eq("vendor_id", vendor.id);

    if (error) {
      setUnits((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: u.status } : x)));
      setUpdatingId(null);
      toast.error(error.message || "Status update failed");
      return;
    }

    toast.success(`Status updated to ${next}`);
    await fetchUnits();
    setUpdatingId(null);
  };

  // Intercept SOLD to force customer dialog
  const updateStatus = async (u: UnitRow, next: InventoryStatus) => {
    if (next === "SOLD") {
      openSoldDialog(u);
      return;
    }
    await updateStatusDirect(u, next);
  };

  const markReturned = (u: UnitRow) => updateStatusDirect(u, "RETURNED");

  // ---------------- Customer suggestions ----------------
  useEffect(() => {
    if (!soldDialogOpen || !vendor?.id) return;

    const q = custQuery.trim();
    if (q.length < 2) {
      setCustSuggestions([]);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      setCustLoading(true);
      try {
        // Search by name or phone or email (simple)
        const { data, error } = await supabase
          .from("customers")
          .select("id,name,phone,email,address")
          .eq("vendor_id", vendor.id)
          .or(
            `name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`
          )
          .order("created_at", { ascending: false })
          .limit(8);

        if (cancelled) return;

        if (error) {
          console.warn(error);
          setCustSuggestions([]);
        } else {
          setCustSuggestions((data ?? []) as any);
        }
      } finally {
        if (!cancelled) setCustLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [custQuery, soldDialogOpen, vendor?.id]);

  const chooseSuggestion = (c: CustomerRow) => {
    setSelectedCustomerId(c.id);
    setCustName(c.name ?? "");
    setCustPhone(c.phone ?? "");
    setCustEmail(c.email ?? "");
    setCustAddress(c.address ?? "");
    setCustSuggestions([]);
    setCustQuery(c.name ?? "");
  };

  // ---------------- SOLD save flow ----------------
  const saveSoldWithCustomer = async () => {
    if (!vendor?.id || !soldTargetUnit) return;

    const name = custName.trim();
    const phone = custPhone.trim();
    const email = custEmail.trim();
    const address = custAddress.trim();

    if (!name) {
      toast.error("Customer name is required");
      return;
    }

    setUpdatingId(soldTargetUnit.id);

    try {
      let customerId = selectedCustomerId;

      // If not selected, try to reuse existing by phone/email (to avoid duplicates)
      if (!customerId && (phone || email)) {
        const ors: string[] = [];
        if (phone) ors.push(`phone.eq.${phone}`);
        if (email) ors.push(`email.eq.${email}`);

        if (ors.length > 0) {
          const { data: existing } = await supabase
            .from("customers")
            .select("id,name,phone,email,address")
            .eq("vendor_id", vendor.id)
            .or(ors.join(","))
            .limit(1);

          if (existing && existing.length > 0) {
            customerId = existing[0].id;
            // also prefer DB canonical values if any
            setSelectedCustomerId(existing[0].id);
          }
        }
      }

      // Create customer if still not found
      if (!customerId) {
        const { data: created, error: cErr } = await supabase
          .from("customers")
          .insert([
            {
              vendor_id: vendor.id,
              name,
              phone: phone || null,
              email: email || null,
              address: address || null,
            },
          ])
          .select("id")
          .single();

        if (cErr) {
          toast.error(cErr.message || "Failed to save customer");
          return;
        }

        customerId = created.id;
      }

      // Update unit -> SOLD + customer snapshot
      const { error: uErr } = await supabase
        .from("inventory_units")
        .update({
          status: "SOLD",
          sold_customer_id: customerId,
          sold_customer_name: name,
          sold_customer_phone: phone || null,
          sold_customer_email: email || null,
          sold_customer_address: address || null,
          sold_at: new Date().toISOString(),
        })
        .eq("id", soldTargetUnit.id)
        .eq("vendor_id", vendor.id);

      if (uErr) {
        toast.error(uErr.message || "Failed to mark as SOLD");
        return;
      }

      toast.success("Marked SOLD with customer details");
      setSoldDialogOpen(false);
      setSoldTargetUnit(null);
      await fetchUnits();
    } finally {
      setUpdatingId(null);
    }
  };

  // ---------------- Export CSV (all units for this product) ----------------
  const exportCsv = async () => {
    if (!vendor?.id) return;
    if (!product?.name) {
      toast.error("Product not loaded yet");
      return;
    }

    setExporting(true);
    try {
      const all: UnitRow[] = [];
      const chunk = 1000;
      let from = 0;

      while (true) {
        const to = from + chunk - 1;

        const { data, error } = await supabase
          .from("inventory_units")
          .select("id,unit_code,manufacture_date,expiry_date,status,created_at")
          .eq("vendor_id", vendor.id)
          .eq("product_id", productId)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (error) {
          toast.error(error.message || "Export failed");
          return;
        }

        const rows = (data ?? []) as any as UnitRow[];
        all.push(...rows);

        if (rows.length < chunk) break;
        from += chunk;
      }

      const mrp = product?.price ?? "";
      const header = ["product_name", "mrp_price", "unit_code"];
      const lines = [header.join(",")];

      for (const u of all) {
        lines.push(
          [csvEscape(product.name), csvEscape(mrp), csvEscape(u.unit_code)].join(",")
        );
      }

      const csv = lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

      const safeName = product.name.replace(/[^\w\-]+/g, "_");
      const filename = `units_${safeName}_${toYmd(new Date())}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`Exported ${all.length} units`);
    } finally {
      setExporting(false);
    }
  };

  if (!hydrated) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-lg">
            Units — {product?.name ?? "Product"}
          </CardTitle>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()}>
              Back
            </Button>

            <Button variant="outline" onClick={exportCsv} disabled={exporting || !product}>
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>

            <Button onClick={() => setDialogOpen(true)}>Add units</Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Product Code: <b>{product?.product_code ?? "-"}</b>
            {brand ? (
              <>
                {" "}• Brand Code: <b>{brand.brand_code ?? "-"}</b>
              </>
            ) : null}
            {" "}• MRP: <b>{product?.price ?? "-"}</b>
            {" "}• Expired on this page: <b>{expiredCountThisPage}</b>
          </div>

          <div className="grid grid-cols-6 gap-2 text-sm">
            <div>In stock: <b>{countsThisPage.IN_STOCK}</b></div>
            <div>Invoiced: <b>{countsThisPage.INVOICED}</b></div>
            <div>Demo: <b>{countsThisPage.DEMO}</b></div>
            <div>Sold: <b>{countsThisPage.SOLD}</b></div>
            <div>Returned: <b>{countsThisPage.RETURNED}</b></div>
            <div>Out: <b>{countsThisPage.OUT_OF_STOCK}</b></div>
          </div>

          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by unit code…"
              className="max-w-sm"
            />

            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as any);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>

              <SelectContent
                position="popper"
                side="bottom"
                align="start"
                sideOffset={6}
                className="z-[200] bg-background text-foreground border shadow-lg p-1"
              >
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="IN_STOCK">In stock</SelectItem>
                <SelectItem value="INVOICED">Invoiced</SelectItem>
                <SelectItem value="DEMO">Demo</SelectItem>
                <SelectItem value="SOLD">Sold</SelectItem>
                <SelectItem value="RETURNED">Returned</SelectItem>
                <SelectItem value="OUT_OF_STOCK">Out of stock</SelectItem>
              </SelectContent>
            </Select>

            <div className="ml-auto text-sm text-muted-foreground">
              Total: <b>{totalCount}</b> • Page <b>{page}</b> / <b>{totalPages}</b>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit code</TableHead>
                  <TableHead>MFG</TableHead>
                  <TableHead>EXP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {units.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      No units found.
                    </TableCell>
                  </TableRow>
                ) : (
                  units.map((u) => {
                    const exp = u.expiry_date ? String(u.expiry_date).slice(0, 10) : null;
                    const expired = !!(exp && exp < todayYmd);

                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-mono">{u.unit_code}</TableCell>
                        <TableCell>{u.manufacture_date ?? "-"}</TableCell>
                        <TableCell>{u.expiry_date ?? "-"}</TableCell>

                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center flex-wrap gap-2">
                            <UnitStatusBadge status={u.status} expired={expired} />

                            {/* Small helper text for SOLD */}
                            {u.status === "SOLD" && (u.sold_customer_name || u.sold_customer_phone) ? (
                              <span className="text-xs text-muted-foreground">
                                • {u.sold_customer_name ?? "Customer"} {u.sold_customer_phone ? `(${u.sold_customer_phone})` : ""}
                              </span>
                            ) : null}

                            <Select
                              value={u.status}
                              onValueChange={(v) => updateStatus(u, v as InventoryStatus)}
                              disabled={updatingId === u.id}
                            >
                              <SelectTrigger className="h-8 w-[170px]">
                                <SelectValue />
                              </SelectTrigger>

                              <SelectContent
                                position="popper"
                                side="bottom"
                                align="start"
                                sideOffset={6}
                                className="z-[200] bg-background text-foreground border shadow-lg p-1"
                              >
                                <SelectItem value="IN_STOCK">IN_STOCK</SelectItem>
                                <SelectItem value="INVOICED">INVOICED</SelectItem>
                                <SelectItem value="DEMO">DEMO</SelectItem>
                                <SelectItem value="SOLD">SOLD</SelectItem>
                                <SelectItem value="RETURNED">RETURNED</SelectItem>
                                <SelectItem value="OUT_OF_STOCK">OUT_OF_STOCK</SelectItem>
                              </SelectContent>
                            </Select>

                            {/* Quick actions */}
                            {u.status !== "SOLD" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={updatingId === u.id}
                                onClick={() => openSoldDialog(u)}
                              >
                                Mark Sold
                              </Button>
                            ) : null}

                            {/* Returned only useful after sold */}
                            {u.status === "SOLD" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={updatingId === u.id}
                                onClick={() => markReturned(u)}
                              >
                                Mark Returned
                              </Button>
                            ) : null}

                            {updatingId === u.id ? (
                              <span className="text-xs text-muted-foreground">Updating…</span>
                            ) : null}
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                              Edit
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => deleteUnit(u)}>
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-end gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Create */}
      {vendor?.id ? (
        <UnitUpsertDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mode="create"
          vendorId={vendor.id}
          productId={productId}
          onSaved={() => {
            setPage(1);
            fetchUnits();
          }}
        />
      ) : null}

      {/* Edit */}
      {vendor?.id && editUnit ? (
        <UnitUpsertDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          vendorId={vendor.id}
          productId={productId}
          initial={editUnit as any}
          onSaved={() => fetchUnits()}
        />
      ) : null}

      {/* SOLD Customer Dialog */}
      <Dialog
        open={soldDialogOpen}
        onOpenChange={(v) => {
          setSoldDialogOpen(v);
          if (!v) {
            setSoldTargetUnit(null);
            resetSoldForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Mark as SOLD</DialogTitle>
            <DialogDescription>
              Add customer details for this sale. Existing customers will appear as suggestions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Unit: <b className="font-mono">{soldTargetUnit?.unit_code ?? "-"}</b>
            </div>

            {/* Search */}
            <div className="relative">
              <Input
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
                placeholder="Search customer by name / phone / email…"
                className="bg-background"
              />

              {(custLoading || custSuggestions.length > 0) ? (
                <div className="absolute z-[300] mt-1 w-full rounded-md border bg-background shadow-lg">
                  {custLoading ? (
                    <div className="p-2 text-sm text-muted-foreground">Searching…</div>
                  ) : custSuggestions.length === 0 ? null : (
                    <div className="max-h-[220px] overflow-auto">
                      {custSuggestions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-muted"
                          onClick={() => chooseSuggestion(c)}
                        >
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.phone ?? "—"} • {c.email ?? "—"}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Form */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Customer name *</div>
                <Input
                  value={custName}
                  onChange={(e) => {
                    setCustName(e.target.value);
                    setSelectedCustomerId(null); // typing means new/unknown
                  }}
                  placeholder="Customer name"
                  className="bg-background"
                />
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Phone</div>
                <Input
                  value={custPhone}
                  onChange={(e) => {
                    setCustPhone(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Phone"
                  className="bg-background"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <div className="text-xs text-muted-foreground">Email</div>
                <Input
                  value={custEmail}
                  onChange={(e) => {
                    setCustEmail(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Email"
                  className="bg-background"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <div className="text-xs text-muted-foreground">Address</div>
                <Input
                  value={custAddress}
                  onChange={(e) => {
                    setCustAddress(e.target.value);
                    setSelectedCustomerId(null);
                  }}
                  placeholder="Address"
                  className="bg-background"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSoldDialogOpen(false);
                setSoldTargetUnit(null);
                resetSoldForm();
              }}
            >
              Cancel
            </Button>

            <Button
              onClick={saveSoldWithCustomer}
              disabled={!soldTargetUnit || updatingId === soldTargetUnit?.id}
            >
              {updatingId === soldTargetUnit?.id ? "Saving..." : "Save & Mark SOLD"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
