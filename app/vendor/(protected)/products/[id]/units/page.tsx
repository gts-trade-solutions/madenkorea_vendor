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
  sale_price: number | null;
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

export default function ProductUnitsPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const productId = params.id;

  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const [vendor, setVendor] = useState<VendorInfo | null>(null);

  const [product, setProduct] = useState<ProductRow | null>(null);
  const [brand, setBrand] = useState<BrandRow | null>(null);

  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InventoryStatus | "ALL">(
    "ALL"
  );

  // date filters (YYYY-MM-DD)
  const [mfgFrom, setMfgFrom] = useState<string>("");
  const [mfgTo, setMfgTo] = useState<string>("");
  const [expFrom, setExpFrom] = useState<string>("");
  const [expTo, setExpTo] = useState<string>("");
  const [includeNoExpiry, setIncludeNoExpiry] = useState<boolean>(true);

  // pagination
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [totalCount, setTotalCount] = useState(0);

  // dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<UnitRow | null>(null);

  // per-row update
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // export
  const [exporting, setExporting] = useState(false);

  // applied-filters version (dates don’t auto-trigger fetch until Apply)
  const [filtersVersion, setFiltersVersion] = useState(0);

  const todayYmd = useMemo(() => toYmd(new Date()), []);

  // ---------------- Selection (for batch actions) ----------------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const allSelectedOnPage =
    units.length > 0 && units.every((u) => selectedIds.has(u.id));
  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) units.forEach((u) => next.add(u.id));
      else units.forEach((u) => next.delete(u.id));
      return next;
    });
  };

  // ---------------- Bulk delete dialog ----------------
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteScope, setBulkDeleteScope] = useState<
    "SELECTED" | "FILTERED"
  >("SELECTED");
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // ---------------- SOLD customer dialog (kept minimal) ----------------
  const [soldDialogOpen, setSoldDialogOpen] = useState(false);
  const [soldTargetUnit, setSoldTargetUnit] = useState<UnitRow | null>(null);

  const [custQuery, setCustQuery] = useState("");
  const [custLoading, setCustLoading] = useState(false);
  const [custSuggestions, setCustSuggestions] = useState<CustomerRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null
  );

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

  const openSoldDialogSingle = (u: UnitRow) => {
    setSoldTargetUnit(u);
    resetSoldForm();

    if (u.sold_customer_name) setCustName(u.sold_customer_name ?? "");
    if (u.sold_customer_phone) setCustPhone(u.sold_customer_phone ?? "");

    setSoldDialogOpen(true);
  };

  // ---------------- Auth + vendor ----------------
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

      const arr = Array.isArray(data) ? data : data ? [data] : [];
      const v = arr[0] as VendorInfo | undefined;

      if (!v || v.status !== "approved") {
        router.replace("/vendor");
        return;
      }

      setVendor(v);
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() =>
      setHydrated(true)
    );

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
        .select("id,name,slug,vendor_id,product_code,brand_id,sale_price")
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

  // ---------------- Filters applied to query ----------------
  function applyUnitFilters(q: any) {
    if (statusFilter !== "ALL") q = q.eq("status", statusFilter);

    const s = search.trim();
    if (s) q = q.ilike("unit_code", `%${s}%`);

    if (mfgFrom) q = q.gte("manufacture_date", mfgFrom);
    if (mfgTo) q = q.lte("manufacture_date", mfgTo);

    if (expFrom || expTo) {
      if (!includeNoExpiry) {
        if (expFrom) q = q.gte("expiry_date", expFrom);
        if (expTo) q = q.lte("expiry_date", expTo);
      } else {
        const parts: string[] = ["expiry_date.is.null"];
        if (expFrom && expTo)
          parts.push(
            `and(expiry_date.gte.${expFrom},expiry_date.lte.${expTo})`
          );
        else if (expFrom) parts.push(`expiry_date.gte.${expFrom}`);
        else if (expTo) parts.push(`expiry_date.lte.${expTo}`);
        q = q.or(parts.join(","));
      }
    }

    return q;
  }

  function baseUnitsQuery(select: string, withCount = false) {
    if (!vendor?.id) return null;
    let q = supabase
      .from("inventory_units")
      .select(select, withCount ? { count: "exact" } : undefined)
      .eq("vendor_id", vendor.id)
      .eq("product_id", productId);

    q = applyUnitFilters(q);
    return q;
  }

  // -------- Fetch units --------
  const fetchUnits = async () => {
    if (!vendor?.id) return;

    setLoading(true);
    try {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let q = baseUnitsQuery(
        "id,unit_code,manufacture_date,expiry_date,status,created_at,sold_customer_name,sold_customer_phone",
        true
      );
      if (!q) return;

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
  }, [ready, vendor?.id, productId, page, statusFilter, filtersVersion]);

  // debounced search
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

  const activeFilterSummary = useMemo(() => {
    const chips: string[] = [];
    const s = search.trim();
    if (s) chips.push(`Search: ${s}`);
    if (statusFilter !== "ALL") chips.push(`Status: ${statusFilter}`);
    if (mfgFrom || mfgTo)
      chips.push(`MFG: ${mfgFrom || "…"} → ${mfgTo || "…"}`);
    if (expFrom || expTo)
      chips.push(
        `EXP: ${expFrom || "…"} → ${expTo || "…"}${
          includeNoExpiry ? " (+null)" : ""
        }`
      );
    return chips;
  }, [search, statusFilter, mfgFrom, mfgTo, expFrom, expTo, includeNoExpiry]);

  // ---------------- Single edit/delete ----------------
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

  // ---------------- Status updates (single) ----------------
  const updateStatusDirect = async (u: UnitRow, next: InventoryStatus) => {
    if (!vendor?.id) return;
    if (u.status === next) return;

    if (next === "SOLD") {
      openSoldDialogSingle(u);
      return;
    }

    setUpdatingId(u.id);

    // optimistic
    setUnits((prev) =>
      prev.map((x) => (x.id === u.id ? { ...x, status: next } : x))
    );

    const { error } = await supabase
      .from("inventory_units")
      .update({ status: next })
      .eq("id", u.id)
      .eq("vendor_id", vendor.id);

    if (error) {
      setUnits((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, status: u.status } : x))
      );
      setUpdatingId(null);
      toast.error(error.message || "Status update failed");
      return;
    }

    toast.success(`Status updated to ${next}`);
    await fetchUnits();
    setUpdatingId(null);
  };

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
        const { data, error } = await supabase
          .from("customers")
          .select("id,name,phone,email,address")
          .eq("vendor_id", vendor.id)
          .or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
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

  const resolveOrCreateCustomer = async (): Promise<string | null> => {
    if (!vendor?.id) return null;

    const name = custName.trim();
    const phone = custPhone.trim();
    const email = custEmail.trim();
    const address = custAddress.trim();

    if (!name) {
      toast.error("Customer name is required");
      return null;
    }

    let customerId = selectedCustomerId;

    if (!customerId && (phone || email)) {
      const ors: string[] = [];
      if (phone) ors.push(`phone.eq.${phone}`);
      if (email) ors.push(`email.eq.${email}`);

      if (ors.length > 0) {
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("vendor_id", vendor.id)
          .or(ors.join(","))
          .limit(1);

        if (existing && existing.length > 0) customerId = existing[0].id;
      }
    }

    if (!customerId) {
      const { data: created, error } = await supabase
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

      if (error) {
        toast.error(error.message || "Failed to save customer");
        return null;
      }
      customerId = created.id;
    }

    return customerId;
  };

  const saveSoldWithCustomer = async () => {
    if (!vendor?.id || !soldTargetUnit) return;

    const name = custName.trim();
    const phone = custPhone.trim();

    const customerId = await resolveOrCreateCustomer();
    if (!customerId) return;

    setUpdatingId(soldTargetUnit.id);
    try {
      const { error } = await supabase
        .from("inventory_units")
        .update({
          status: "SOLD",
          sold_customer_id: customerId,
          sold_customer_name: name,
          sold_customer_phone: phone || null,
          sold_at: new Date().toISOString(),
        })
        .eq("vendor_id", vendor.id)
        .eq("product_id", productId)
        .eq("id", soldTargetUnit.id);

      if (error) {
        toast.error(error.message || "Failed to mark SOLD");
        return;
      }

      toast.success("Marked SOLD with customer details");
      setSoldDialogOpen(false);
      setSoldTargetUnit(null);
      resetSoldForm();
      await fetchUnits();
    } finally {
      setUpdatingId(null);
    }
  };

  // ---------------- Export helpers ----------------
  const buildCsv = (rows: UnitRow[]) => {
    if (!product) return "";

    const header = [
      "product_name",
      "mrp_price",
      "unit_code",
      "status",
      "manufacture_date",
      "expiry_date",
      "sold_customer_name",
      "sold_customer_phone",
    ];
    const lines = [header.join(",")];

    const mrp = product.sale_price ?? "";

    for (const u of rows) {
      lines.push(
        [
          csvEscape(product.name),
          csvEscape(mrp),
          csvEscape(u.unit_code),
          csvEscape(u.status),
          csvEscape(u.manufacture_date ?? ""),
          csvEscape(u.expiry_date ?? ""),
          csvEscape(u.sold_customer_name ?? ""),
          csvEscape(u.sold_customer_phone ?? ""),
        ].join(",")
      );
    }

    return lines.join("\n");
  };

  const downloadCsv = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCurrentPage = async () => {
    if (!product) return toast.error("Product not loaded yet");
    const csv = buildCsv(units);
    const safeName = product.name.replace(/[^\w\-]+/g, "_");
    downloadCsv(csv, `units_page_${safeName}_${toYmd(new Date())}.csv`);
    toast.success(`Exported ${units.length} units (current page)`);
  };

  const exportFilteredAll = async () => {
    if (!vendor?.id) return;
    if (!product) return toast.error("Product not loaded yet");

    setExporting(true);
    try {
      const all: UnitRow[] = [];
      const chunk = 1000;
      let from = 0;

      while (true) {
        const to = from + chunk - 1;

        let q = baseUnitsQuery(
          "id,unit_code,manufacture_date,expiry_date,status,created_at,sold_customer_name,sold_customer_phone",
          false
        );
        if (!q) return;

        const { data, error } = await q
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

      const csv = buildCsv(all);
      const safeName = product.name.replace(/[^\w\-]+/g, "_");
      downloadCsv(csv, `units_filtered_${safeName}_${toYmd(new Date())}.csv`);
      toast.success(`Exported ${all.length} units (filtered)`);
    } finally {
      setExporting(false);
    }
  };

  // ✅ NEW: Export Selected (all pages)
  const fetchSelectedUnits = async (): Promise<UnitRow[]> => {
    if (!vendor?.id) return [];

    const ids = Array.from(selectedIds);
    if (ids.length === 0) return [];

    const out: UnitRow[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);

      const { data, error } = await supabase
        .from("inventory_units")
        .select(
          "id,unit_code,manufacture_date,expiry_date,status,created_at,sold_customer_name,sold_customer_phone"
        )
        .eq("vendor_id", vendor.id)
        .eq("product_id", productId)
        .in("id", slice)
        .order("created_at", { ascending: false });

      if (error) {
        toast.error(error.message || "Failed to load selected units");
        return [];
      }

      out.push(...((data ?? []) as any as UnitRow[]));
    }

    return out;
  };

  const exportSelected = async () => {
    if (!product) return toast.error("Product not loaded yet");
    if (selectedIds.size === 0) return toast.error("No units selected");

    setExporting(true);
    try {
      const rows = await fetchSelectedUnits();
      if (rows.length === 0) return;

      const csv = buildCsv(rows);
      const safeName = product.name.replace(/[^\w\-]+/g, "_");
      downloadCsv(csv, `units_selected_${safeName}_${toYmd(new Date())}.csv`);
      toast.success(`Exported ${rows.length} selected units`);
    } finally {
      setExporting(false);
    }
  };

  // ---------------- Bulk delete handler ----------------
  const runBulkDelete = async () => {
    if (!vendor?.id) return;

    if (bulkDeleteConfirm.trim().toUpperCase() !== "DELETE") {
      toast.error('Type "DELETE" to confirm');
      return;
    }

    setBulkDeleting(true);
    try {
      if (bulkDeleteScope === "SELECTED") {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
          toast.error("No units selected");
          return;
        }

        for (let i = 0; i < ids.length; i += 500) {
          const slice = ids.slice(i, i + 500);
          const { error } = await supabase
            .from("inventory_units")
            .delete()
            .eq("vendor_id", vendor.id)
            .eq("product_id", productId)
            .in("id", slice);

          if (error) {
            toast.error(error.message || "Bulk delete failed");
            return;
          }
        }

        toast.success(`Deleted ${ids.length} selected units`);
        setSelectedIds(new Set());
      } else {
        // FILTERED
        let q = supabase
          .from("inventory_units")
          .delete()
          .eq("vendor_id", vendor.id)
          .eq("product_id", productId);

        q = applyUnitFilters(q);

        const { error } = await q;
        if (error) {
          toast.error(error.message || "Bulk delete failed");
          return;
        }

        toast.success("Deleted filtered units");
        setSelectedIds(new Set());
      }

      setBulkDeleteOpen(false);
      setBulkDeleteConfirm("");
      setPage(1);
      await fetchUnits();
    } finally {
      setBulkDeleting(false);
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

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={() => router.back()}>
              Back
            </Button>

            <Button
              variant="outline"
              onClick={exportCurrentPage}
              disabled={!product || loading}
            >
              Export Page
            </Button>

            <Button
              variant="outline"
              onClick={exportFilteredAll}
              disabled={exporting || !product}
            >
              {exporting ? "Exporting…" : "Export Filtered"}
            </Button>

            {/* ✅ NEW */}
            <Button
              variant="outline"
              onClick={exportSelected}
              disabled={exporting || selectedIds.size === 0 || !product}
              title="Export selected units"
            >
              Export Selected ({selectedIds.size})
            </Button>

            <Button onClick={() => setCreateOpen(true)}>Add units</Button>

            {/* ✅ Bulk Delete */}
            <Button
              variant="destructive"
              disabled={selectedIds.size === 0}
              onClick={() => {
                setBulkDeleteScope("SELECTED");
                setBulkDeleteConfirm("");
                setBulkDeleteOpen(true);
              }}
              title="Delete selected units"
            >
              Delete Selected ({selectedIds.size})
            </Button>

            <Button
              variant="destructive"
              onClick={() => {
                setBulkDeleteScope("FILTERED");
                setBulkDeleteConfirm("");
                setBulkDeleteOpen(true);
              }}
              title="Delete filtered units"
            >
              Delete Filtered ({totalCount})
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Product Code: <b>{product?.product_code ?? "-"}</b>
            {brand ? (
              <>
                {" "}
                • Brand Code: <b>{brand.brand_code ?? "-"}</b>
              </>
            ) : null}{" "}
            • MRP: <b>{product?.sale_price ?? "-"}</b> • Expired on this page:{" "}
            <b>{expiredCountThisPage}</b>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
            <div>
              In stock: <b>{countsThisPage.IN_STOCK}</b>
            </div>
            <div>
              Invoiced: <b>{countsThisPage.INVOICED}</b>
            </div>
            <div>
              Demo: <b>{countsThisPage.DEMO}</b>
            </div>
            <div>
              Sold: <b>{countsThisPage.SOLD}</b>
            </div>
            <div>
              Returned: <b>{countsThisPage.RETURNED}</b>
            </div>
            <div>
              Out: <b>{countsThisPage.OUT_OF_STOCK}</b>
            </div>
          </div>

          {/* Filters */}
          <div className="rounded-md border p-3 space-y-3">
            <div className="flex flex-col md:flex-row gap-2 md:items-center">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search unit code…"
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
                Total: <b>{totalCount}</b> • Page <b>{page}</b> /{" "}
                <b>{totalPages}</b>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-2 md:items-end">
              <div className="flex gap-2 flex-wrap">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">MFG from</div>
                  <Input
                    type="date"
                    value={mfgFrom}
                    onChange={(e) => setMfgFrom(e.target.value)}
                    className="w-[170px]"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">MFG to</div>
                  <Input
                    type="date"
                    value={mfgTo}
                    onChange={(e) => setMfgTo(e.target.value)}
                    className="w-[170px]"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">EXP from</div>
                  <Input
                    type="date"
                    value={expFrom}
                    onChange={(e) => setExpFrom(e.target.value)}
                    className="w-[170px]"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">EXP to</div>
                  <Input
                    type="date"
                    value={expTo}
                    onChange={(e) => setExpTo(e.target.value)}
                    className="w-[170px]"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm ml-2">
                  <input
                    type="checkbox"
                    checked={includeNoExpiry}
                    onChange={(e) => setIncludeNoExpiry(e.target.checked)}
                  />
                  Include no-expiry
                </label>
              </div>

              <div className="flex gap-2 md:ml-auto">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPage(1);
                    setFiltersVersion((x) => x + 1);
                  }}
                >
                  Apply
                </Button>

                <Button
                  variant="outline"
                  onClick={() => {
                    setMfgFrom("");
                    setMfgTo("");
                    setExpFrom("");
                    setExpTo("");
                    setIncludeNoExpiry(true);
                    setStatusFilter("ALL");
                    setSearch("");
                    setSelectedIds(new Set());
                    setPage(1);
                    setFiltersVersion((x) => x + 1);
                  }}
                >
                  Clear all
                </Button>
              </div>
            </div>

            {activeFilterSummary.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                Active filters: <b>{activeFilterSummary.join(" • ")}</b>
              </div>
            ) : null}
          </div>

          {selectedIds.size > 0 ? (
            <div className="flex items-center justify-between text-sm">
              <div>
                Selected: <b>{selectedIds.size}</b>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportSelected}
                  disabled={exporting || !product}
                >
                  Export Selected
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setBulkDeleteScope("SELECTED");
                    setBulkDeleteConfirm("");
                    setBulkDeleteOpen(true);
                  }}
                >
                  Delete Selected
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear selection
                </Button>
              </div>
            </div>
          ) : null}
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
                  <TableHead className="w-[40px]">
                    <input
                      type="checkbox"
                      checked={allSelectedOnPage}
                      onChange={(e) => toggleSelectAllOnPage(e.target.checked)}
                      aria-label="Select all on page"
                    />
                  </TableHead>
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
                    <TableCell
                      colSpan={6}
                      className="text-sm text-muted-foreground"
                    >
                      No units found.
                    </TableCell>
                  </TableRow>
                ) : (
                  units.map((u) => {
                    const exp = u.expiry_date
                      ? String(u.expiry_date).slice(0, 10)
                      : null;
                    const expired = !!(exp && exp < todayYmd);

                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(u.id)}
                            onChange={(e) =>
                              toggleSelect(u.id, e.target.checked)
                            }
                            aria-label={`Select ${u.unit_code}`}
                          />
                        </TableCell>

                        <TableCell className="font-mono">
                          {u.unit_code}
                        </TableCell>
                        <TableCell>{u.manufacture_date ?? "-"}</TableCell>
                        <TableCell>{u.expiry_date ?? "-"}</TableCell>

                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center flex-wrap gap-2">
                            <UnitStatusBadge
                              status={u.status}
                              expired={expired}
                            />

                            {u.status === "SOLD" &&
                            (u.sold_customer_name || u.sold_customer_phone) ? (
                              <span className="text-xs text-muted-foreground">
                                • {u.sold_customer_name ?? "Customer"}{" "}
                                {u.sold_customer_phone
                                  ? `(${u.sold_customer_phone})`
                                  : ""}
                              </span>
                            ) : null}

                            <Select
                              value={u.status}
                              onValueChange={(v) =>
                                updateStatusDirect(u, v as InventoryStatus)
                              }
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
                                <SelectItem value="IN_STOCK">
                                  IN_STOCK
                                </SelectItem>
                                <SelectItem value="INVOICED">
                                  INVOICED
                                </SelectItem>
                                <SelectItem value="DEMO">DEMO</SelectItem>
                                <SelectItem value="SOLD">SOLD</SelectItem>
                                <SelectItem value="RETURNED">
                                  RETURNED
                                </SelectItem>
                                <SelectItem value="OUT_OF_STOCK">
                                  OUT_OF_STOCK
                                </SelectItem>
                              </SelectContent>
                            </Select>

                            {u.status !== "SOLD" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={updatingId === u.id}
                                onClick={() => openSoldDialogSingle(u)}
                              >
                                Mark Sold
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={updatingId === u.id}
                                onClick={() =>
                                  updateStatusDirect(u, "RETURNED")
                                }
                              >
                                Mark Returned
                              </Button>
                            )}

                            {updatingId === u.id ? (
                              <span className="text-xs text-muted-foreground">
                                Updating…
                              </span>
                            ) : null}
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEdit(u)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => deleteUnit(u)}
                            >
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
          open={createOpen}
          onOpenChange={setCreateOpen}
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

      {/* Bulk Delete Dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Bulk delete units
            </DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              <b>
                {bulkDeleteScope === "SELECTED"
                  ? `${selectedIds.size} selected`
                  : `${totalCount} filtered`}
              </b>{" "}
              units. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Scope</div>
            <Select
              value={bulkDeleteScope}
              onValueChange={(v) => setBulkDeleteScope(v as any)}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background">
                <SelectItem value="SELECTED">
                  Selected ({selectedIds.size})
                </SelectItem>
                <SelectItem value="FILTERED">
                  Filtered (current filters: {totalCount})
                </SelectItem>
              </SelectContent>
            </Select>

            <div className="text-sm text-muted-foreground">
              Type <b>DELETE</b> to confirm:
            </div>
            <Input
              value={bulkDeleteConfirm}
              onChange={(e) => setBulkDeleteConfirm(e.target.value)}
              placeholder='Type "DELETE"'
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={runBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>Mark as SOLD</DialogTitle>
            <DialogDescription>
              Add customer details for the sale. Existing customers will appear
              as suggestions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Unit:{" "}
              <b className="font-mono">{soldTargetUnit?.unit_code ?? "-"}</b>
            </div>

            <div className="relative">
              <Input
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
                placeholder="Search customer by name / phone / email…"
                className="bg-background"
              />

              {custLoading || custSuggestions.length > 0 ? (
                <div className="absolute z-[300] mt-1 w-full rounded-md border bg-background shadow-lg">
                  {custLoading ? (
                    <div className="p-2 text-sm text-muted-foreground">
                      Searching…
                    </div>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Customer name *
                </div>
                <Input
                  value={custName}
                  onChange={(e) => {
                    setCustName(e.target.value);
                    setSelectedCustomerId(null);
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
              {updatingId === soldTargetUnit?.id
                ? "Saving…"
                : "Save & Mark SOLD"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
