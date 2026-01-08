"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  price?: number | null; // ✅ unit price
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
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20);
  const [totalCount, setTotalCount] = useState(0);

  // dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<UnitRow | null>(null);

  // per-row update
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // export
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // filters modal
  const [filtersOpen, setFiltersOpen] = useState(false);

  // applied-filters version (fetch only when apply)
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

  // ---------------- Bulk edit dialog ----------------

  const [bulkNewPrice, setBulkNewPrice] = useState<string>(""); // empty = no change

  // ---------------- SOLD customer dialog ----------------
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

  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditScope, setBulkEditScope] = useState<"SELECTED" | "FILTERED">(
    "SELECTED"
  );
  const [bulkEditing, setBulkEditing] = useState(false);

  const [bulkNewStatus, setBulkNewStatus] = useState<
    InventoryStatus | "NO_CHANGE"
  >("NO_CHANGE");

  // ✅ NEW: dates (empty = no change)
  const [bulkNewMfgDate, setBulkNewMfgDate] = useState<string>("");
  const [bulkNewExpDate, setBulkNewExpDate] = useState<string>(""); // allow empty string = "no change"

  // sort
  const [sortBy, setSortBy] = useState<
    | "created_desc"
    | "created_asc"
    | "exp_asc"
    | "exp_desc"
    | "mfg_desc"
    | "mfg_asc"
    | "code_asc"
    | "code_desc"
  >("created_desc");

  // expired quick filter
  const [expiredFilter, setExpiredFilter] = useState<
    "ALL" | "EXPIRED" | "NOT_EXPIRED"
  >("ALL");

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

  // ---------------- Scan modal (NEW) ----------------
  const [scanOpen, setScanOpen] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [scannedUnit, setScannedUnit] = useState<UnitRow | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!scanOpen) return;
    const t = setTimeout(() => {
      scanInputRef.current?.focus();
      scanInputRef.current?.select();
    }, 80);
    return () => clearTimeout(t);
  }, [scanOpen]);

  const resetScan = () => {
    setScanValue("");
    setScannedUnit(null);
    setTimeout(() => {
      scanInputRef.current?.focus();
      scanInputRef.current?.select();
    }, 50);
  };

  // Print invoice (single scanned unit) — self-contained, no route dependency
  const printSingleUnitInvoice = (u: UnitRow) => {
    if (!product || !vendor) {
      toast.error("Product/Vendor not ready");
      return;
    }

    const now = new Date();
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice - ${u.unit_code}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #111; }
  .row { display:flex; justify-content:space-between; gap: 16px; }
  .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
  .title { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
  .muted { color: #6b7280; font-size: 12px; }
  table { width:100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #e5e7eb; padding: 10px; text-align:left; }
  th { background:#f9fafb; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .right { text-align:right; }
  .big { font-size: 16px; font-weight: 700; }
  .footer { margin-top: 16px; font-size: 12px; color:#6b7280; }
  @media print { .no-print { display:none; } body { margin: 10mm; } }
</style>
</head>
<body>
  <div class="row">
    <div>
      <div class="title">Invoice</div>
      <div class="muted">Generated: ${now.toLocaleString()}</div>
    </div>
    <div class="card" style="min-width: 280px;">
      <div class="muted">Seller</div>
      <div class="big">${vendor.display_name ?? "Vendor"}</div>
      <div class="muted">Product: ${product.name}</div>
      <div class="muted">Unit Code: ${u.unit_code}</div>
    </div>
  </div>

  <div class="card" style="margin-top: 14px;">
    <div class="muted">Customer (if SOLD)</div>
    <div style="margin-top:6px;">
      <b>${u.sold_customer_name ?? "-"}</b> ${
      u.sold_customer_phone ? `(${u.sold_customer_phone})` : ""
    }
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Manufacture</th>
        <th>Expiry</th>
        <th>Status</th>
        <th class="right">Price</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div><b>${product.name}</b></div>
          <div class="muted">Unit: ${u.unit_code}</div>
        </td>
        <td>${u.manufacture_date ?? "-"}</td>
        <td>${u.expiry_date ?? "-"}</td>
        <td>${u.status}</td>
        <td class="right">${u.price ?? ""}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    This invoice is generated from the Units screen (scan flow).
  </div>

  <div class="no-print" style="margin-top:14px;">
    <button onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
  </div>
</body>
</html>`;

    const w = window.open(
      "",
      "_blank",
      "noopener,noreferrer,width=900,height=700"
    );
    if (!w) {
      toast.error("Popup blocked. Please allow popups to print.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    // user can print from the opened window
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

    if (expiredFilter === "EXPIRED") {
      q = q.not("expiry_date", "is", null).lt("expiry_date", todayYmd);
    }
    if (expiredFilter === "NOT_EXPIRED") {
      // includeNoExpiry affects what "not expired" means:
      // - if includeNoExpiry=true => not expired = (expiry_date is null OR expiry_date >= today)
      // - if includeNoExpiry=false => not expired = (expiry_date >= today)
      if (includeNoExpiry) {
        q = q.or(`expiry_date.is.null,expiry_date.gte.${todayYmd}`);
      } else {
        q = q.gte("expiry_date", todayYmd);
      }
    }

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
        "id,unit_code,manufacture_date,expiry_date,status,created_at,price,sold_customer_name,sold_customer_phone",
        true
      );
      if (!q) return;

      if (sortBy === "created_desc")
        q = q.order("created_at", { ascending: false });
      else if (sortBy === "created_asc")
        q = q.order("created_at", { ascending: true });
      else if (sortBy === "exp_asc")
        q = q.order("expiry_date", { ascending: true, nullsFirst: false });
      else if (sortBy === "exp_desc")
        q = q.order("expiry_date", { ascending: false, nullsFirst: false });
      else if (sortBy === "mfg_desc")
        q = q.order("manufacture_date", { ascending: false });
      else if (sortBy === "mfg_asc")
        q = q.order("manufacture_date", { ascending: true });
      else if (sortBy === "code_asc")
        q = q.order("unit_code", { ascending: true });
      else if (sortBy === "code_desc")
        q = q.order("unit_code", { ascending: false });

      const { data, error, count } = await q.range(from, to);

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
  }, [
    ready,
    vendor?.id,
    productId,
    page,
    statusFilter,
    filtersVersion,
    sortBy,
    expiredFilter,
  ]);

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

  // ---------------- Status updates (single row list) ----------------
  const updateStatusDirect = async (u: UnitRow, next: InventoryStatus) => {
    if (!vendor?.id) return;
    if (u.status === next) return;

    if (next === "SOLD") {
      openSoldDialogSingle(u);
      return;
    }

    setUpdatingId(u.id);

    // optimistic (list)
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

  // ---------------- Status updates (scanned unit) ----------------
  const updateScannedStatus = async (next: InventoryStatus) => {
    if (!vendor?.id || !scannedUnit) return;
    if (scannedUnit.status === next) return;

    if (next === "SOLD") {
      // use existing SOLD flow (customer dialog) without breaking features
      openSoldDialogSingle(scannedUnit);
      return;
    }

    setScanLoading(true);
    const prev = scannedUnit.status;
    setScannedUnit({ ...scannedUnit, status: next });

    const { error } = await supabase
      .from("inventory_units")
      .update({ status: next })
      .eq("id", scannedUnit.id)
      .eq("vendor_id", vendor.id)
      .eq("product_id", productId);

    if (error) {
      setScannedUnit({ ...scannedUnit, status: prev });
      setScanLoading(false);
      toast.error(error.message || "Failed to update status");
      return;
    }

    toast.success(`Updated status to ${next}`);
    setScanLoading(false);
    // keep list in sync
    await fetchUnits();
  };

  // ---------------- Scan: lookup unit by code ----------------
  const lookupScannedUnit = async (raw?: string) => {
    if (!vendor?.id) return;

    const code = (raw ?? scanValue).trim();
    if (!code) return;

    setScanLoading(true);
    try {
      const { data, error } = await supabase
        .from("inventory_units")
        .select(
          "id,unit_code,manufacture_date,expiry_date,status,created_at,price,sold_customer_name,sold_customer_phone"
        )
        .eq("vendor_id", vendor.id)
        .eq("product_id", productId)
        .eq("unit_code", code)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setScannedUnit(null);
        toast.error("Unit not found for this product");
        return;
      }

      setScannedUnit(data as any);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Scan lookup failed");
    } finally {
      setScanLoading(false);
      setTimeout(() => {
        // keep cursor ready for next scan
        scanInputRef.current?.focus();
        scanInputRef.current?.select();
      }, 60);
    }
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

      // keep scan panel in sync too
      if (scannedUnit?.id === soldTargetUnit.id) {
        setScannedUnit((prev) =>
          prev
            ? {
                ...prev,
                status: "SOLD",
                sold_customer_name: name,
                sold_customer_phone: phone || null,
              }
            : prev
        );
      }

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
      "unit_price",
      "unit_code",
      "status",
      "manufacture_date",
      "expiry_date",
      "sold_customer_name",
      "sold_customer_phone",
    ];
    const lines = [header.join(",")];

    for (const u of rows) {
      lines.push(
        [
          csvEscape(product.name),
          csvEscape(u.price ?? ""),
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
          "id,unit_code,manufacture_date,expiry_date,status,created_at,price,sold_customer_name,sold_customer_phone",
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
          "id,unit_code,manufacture_date,expiry_date,status,created_at,price,sold_customer_name,sold_customer_phone"
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

  // ---------------- Bulk edit handler (status + price) ----------------
  const runBulkEdit = async () => {
    if (!vendor?.id) return;

    const patch: Record<string, any> = {};

    if (bulkNewStatus !== "NO_CHANGE") {
      if (bulkNewStatus === "SOLD") {
        toast.error(
          'Bulk set to "SOLD" is not allowed (needs customer details).'
        );
        return;
      }
      patch.status = bulkNewStatus;
    }

    // Manufacture date
    if (bulkNewMfgDate.trim() !== "") {
      patch.manufacture_date = bulkNewMfgDate;
    }

    // Expiry date
    // - empty => no change (because user didn’t set it)
    // - if you want to allow "set expiry to NULL", you can add a checkbox later.
    if (bulkNewExpDate.trim() !== "") {
      patch.expiry_date = bulkNewExpDate;
    }

    if (Object.keys(patch).length === 0) {
      toast.error("Nothing to update");
      return;
    }

    setBulkEditing(true);
    try {
      if (bulkEditScope === "SELECTED") {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
          toast.error("No units selected");
          return;
        }

        for (let i = 0; i < ids.length; i += 500) {
          const slice = ids.slice(i, i + 500);
          const { error } = await supabase
            .from("inventory_units")
            .update(patch)
            .eq("vendor_id", vendor.id)
            .eq("product_id", productId)
            .in("id", slice);

          if (error) {
            toast.error(error.message || "Bulk edit failed");
            return;
          }
        }

        toast.success(`Updated ${ids.length} selected units`);
      } else {
        let q = supabase
          .from("inventory_units")
          .update(patch)
          .eq("vendor_id", vendor.id)
          .eq("product_id", productId);

        q = applyUnitFilters(q);

        const { error } = await q;
        if (error) {
          toast.error(error.message || "Bulk edit failed");
          return;
        }

        toast.success("Updated filtered units");
      }

      setBulkEditOpen(false);
      setBulkNewStatus("NO_CHANGE");
      setBulkNewMfgDate("");
      setBulkNewExpDate("");
      await fetchUnits();
    } finally {
      setBulkEditing(false);
    }
  };

  // ---------------- Filter modal apply/clear ----------------
  const applyFilters = () => {
    setPage(1);
    setFiltersVersion((x) => x + 1);
    setFiltersOpen(false);
  };

  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("ALL");
    setMfgFrom("");
    setMfgTo("");
    setExpFrom("");
    setExpTo("");
    setIncludeNoExpiry(true);
    setSelectedIds(new Set());
    setPage(1);
    setFiltersVersion((x) => x + 1);
    setFiltersOpen(false);
  };

  if (!hydrated) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">
              Units — {product?.name ?? "Product"}
            </CardTitle>

            {activeFilterSummary.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                Active filters: <b>{activeFilterSummary.join(" • ")}</b>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No filters applied
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={() => router.back()}>
              Back
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                // clear filters
                setSearch("");
                setStatusFilter("ALL");
                setMfgFrom("");
                setMfgTo("");
                setExpFrom("");
                setExpTo("");
                setIncludeNoExpiry(true);

                // clear selection + reset pagination
                setSelectedIds(new Set());
                setPage(1);

                // force refetch (also ensures list matches cleared filters)
                setFiltersVersion((x) => x + 1);

                toast.success("Refreshed");
              }}
              disabled={!ready}
              title="Clear filters and refresh"
            >
              Refresh
            </Button>
            {/* ✅ NEW: Scan Unit */}
            <Button
              variant="outline"
              onClick={() => {
                setScanOpen(true);
                setScannedUnit(null);
                // keep existing value so continuous scanning works
                setTimeout(() => {
                  scanInputRef.current?.focus();
                  scanInputRef.current?.select();
                }, 80);
              }}
              disabled={!ready || !vendor?.id}
              title="Scan unit code to open the unit details"
            >
              Scan Unit
            </Button>

            <Button
              variant="outline"
              onClick={() => setFiltersOpen(true)}
              disabled={!ready}
              title="Open filters"
            >
              Filters
            </Button>

            <Button
              variant="outline"
              onClick={() => setExportOpen(true)}
              disabled={!product}
              title="Export options"
            >
              Export
            </Button>

            <Button onClick={() => setCreateOpen(true)}>Add units</Button>

            <Button
              variant="outline"
              onClick={() => {
                setBulkEditScope(
                  selectedIds.size > 0 ? "SELECTED" : "FILTERED"
                );
                setBulkNewStatus("NO_CHANGE");
                setBulkNewPrice("");
                setBulkEditOpen(true);
              }}
              disabled={totalCount === 0}
              title="Bulk edit status/price"
            >
              Bulk Edit
              {selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </Button>

            <Button
              variant="destructive"
              onClick={() => {
                setBulkDeleteScope(
                  selectedIds.size > 0 ? "SELECTED" : "FILTERED"
                );
                setBulkDeleteConfirm("");
                setBulkDeleteOpen(true);
              }}
              disabled={totalCount === 0}
              title="Bulk delete"
            >
              Bulk Delete
              {selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
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
            • Expired on this page: <b>{expiredCountThisPage}</b>
            {selectedIds.size > 0 ? (
              <>
                {" "}
                • Selected: <b>{selectedIds.size}</b>
              </>
            ) : null}
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
            {/* <div>
              Out: <b>{countsThisPage.OUT_OF_STOCK}</b>
            </div> */}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3">
            <div className="text-sm text-muted-foreground">
              Total: <b>{totalCount}</b> • Page <b>{page}</b> /{" "}
              <b>{totalPages}</b>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <div className="text-sm text-muted-foreground">Rows</div>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  const n = Number(v) as 20 | 50 | 100;
                  setPageSize(n);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {/* Expired filter */}
            <Select
              value={expiredFilter}
              onValueChange={(v) => {
                setExpiredFilter(v as any);
                setPage(1);
                setFiltersVersion((x) => x + 1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background">
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="EXPIRED">Expired only</SelectItem>
                <SelectItem value="NOT_EXPIRED">Not expired</SelectItem>
              </SelectContent>
            </Select>

            {/* Sort */}
            <Select
              value={sortBy}
              onValueChange={(v) => {
                setSortBy(v as any);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent className="bg-background">
                <SelectItem value="created_desc">Created: Newest</SelectItem>
                <SelectItem value="created_asc">Created: Oldest</SelectItem>
                <SelectItem value="exp_asc">Expiry: Earliest</SelectItem>
                <SelectItem value="exp_desc">Expiry: Latest</SelectItem>
                <SelectItem value="mfg_desc">MFG: Newest</SelectItem>
                <SelectItem value="mfg_asc">MFG: Oldest</SelectItem>
                <SelectItem value="code_asc">Unit code: A–Z</SelectItem>
                <SelectItem value="code_desc">Unit code: Z–A</SelectItem>
              </SelectContent>
            </Select>

            {/* Optional small badge */}
            {expiredCountThisPage > 0 ? (
              <span className="text-xs px-2 py-1 rounded-md border bg-muted">
                Expired: <b>{expiredCountThisPage}</b>
              </span>
            ) : null}
          </div>

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
                                {/* <SelectItem value="OUT_OF_STOCK">
                                  OUT_OF_STOCK
                                </SelectItem> */}
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

      {/* ✅ Scan Modal */}
      <Dialog
        open={scanOpen}
        onOpenChange={(v) => {
          setScanOpen(v);
          if (!v) {
            // don’t wipe everything (so scanner flow is smooth), but clear scanned card
            setScannedUnit(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Scan unit</DialogTitle>
            <DialogDescription>
              Plug in your scanner, click inside the box, and scan. (Most
              scanners type the code + press Enter automatically.)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground mb-2">
                Scan cursor area
              </div>

              <div className="flex gap-2">
                <Input
                  ref={scanInputRef}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      lookupScannedUnit();
                    }
                  }}
                  placeholder="Scan / type unit code and press Enter…"
                  className="h-12 text-base font-mono"
                />
                <Button
                  onClick={() => lookupScannedUnit()}
                  disabled={!scanValue.trim() || scanLoading}
                  className="h-12"
                >
                  {scanLoading ? "Checking…" : "Lookup"}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetScan}
                  disabled={scanLoading}
                >
                  Clear
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    scanInputRef.current?.focus();
                    scanInputRef.current?.select();
                  }}
                  disabled={scanLoading}
                >
                  Focus
                </Button>
              </div>
            </div>

            {/* Scanned unit details */}
            {scannedUnit ? (
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Unit</div>
                    <div className="text-lg font-mono font-semibold">
                      {scannedUnit.unit_code}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      MFG: <b>{scannedUnit.manufacture_date ?? "-"}</b> • EXP:{" "}
                      <b>{scannedUnit.expiry_date ?? "-"}</b> • Price:{" "}
                      <b>{scannedUnit.price ?? "-"}</b>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => {
                        // open existing edit dialog, keep everything unchanged
                        setEditUnit(scannedUnit);
                        setEditOpen(true);
                      }}
                    >
                      Edit Unit
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => printSingleUnitInvoice(scannedUnit)}
                      disabled={!product || !vendor}
                      title="Print invoice for this unit"
                    >
                      Print Invoice
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => {
                        // optional: show it in list using existing filters
                        setSearch(scannedUnit.unit_code);
                        setPage(1);
                        setFiltersVersion((x) => x + 1);
                        toast.success("Applied scanned unit to list filter");
                        setScanOpen(false);
                      }}
                      title="Filter list by this unit"
                    >
                      Show in List
                    </Button>
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-2">
                  <UnitStatusBadge
                    status={scannedUnit.status}
                    expired={
                      !!(
                        scannedUnit.expiry_date &&
                        String(scannedUnit.expiry_date).slice(0, 10) < todayYmd
                      )
                    }
                  />

                  <div className="w-[220px]">
                    <Select
                      value={scannedUnit.status}
                      onValueChange={(v) =>
                        updateScannedStatus(v as InventoryStatus)
                      }
                      disabled={scanLoading}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background">
                        <SelectItem value="IN_STOCK">IN_STOCK</SelectItem>
                        <SelectItem value="INVOICED">INVOICED</SelectItem>
                        <SelectItem value="DEMO">DEMO</SelectItem>
                        <SelectItem value="SOLD">SOLD</SelectItem>
                        <SelectItem value="RETURNED">RETURNED</SelectItem>
                        {/* <SelectItem value="OUT_OF_STOCK">
                          OUT_OF_STOCK
                        </SelectItem> */}
                      </SelectContent>
                    </Select>
                  </div>

                  {scannedUnit.status !== "SOLD" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={scanLoading}
                      onClick={() => openSoldDialogSingle(scannedUnit)}
                    >
                      Mark Sold
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={scanLoading}
                      onClick={() => updateScannedStatus("RETURNED")}
                    >
                      Mark Returned
                    </Button>
                  )}

                  {scannedUnit.status === "SOLD" &&
                  (scannedUnit.sold_customer_name ||
                    scannedUnit.sold_customer_phone) ? (
                    <span className="text-xs text-muted-foreground">
                      • {scannedUnit.sold_customer_name ?? "Customer"}{" "}
                      {scannedUnit.sold_customer_phone
                        ? `(${scannedUnit.sold_customer_phone})`
                        : ""}
                    </span>
                  ) : null}
                </div>

                <div className="text-xs text-muted-foreground">
                  Tip: After updating status, keep scanning the next unit —
                  cursor stays in the scan box.
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setScanOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Filters Modal */}
      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
            <DialogDescription>
              Set filters and click Apply. (Dates are optional.)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Search unit code
                </div>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Eg: ABC-001"
                />
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Status</div>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as any)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="IN_STOCK">IN_STOCK</SelectItem>
                    <SelectItem value="INVOICED">INVOICED</SelectItem>
                    <SelectItem value="DEMO">DEMO</SelectItem>
                    <SelectItem value="SOLD">SOLD</SelectItem>
                    <SelectItem value="RETURNED">RETURNED</SelectItem>
                    {/* <SelectItem value="OUT_OF_STOCK">OUT_OF_STOCK</SelectItem> */}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="text-sm font-medium">Manufacture Date Range</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">MFG From</div>
                  <Input
                    type="date"
                    value={mfgFrom}
                    onChange={(e) => setMfgFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">MFG To</div>
                  <Input
                    type="date"
                    value={mfgTo}
                    onChange={(e) => setMfgTo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Expiry Date Range</div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeNoExpiry}
                    onChange={(e) => setIncludeNoExpiry(e.target.checked)}
                  />
                  Include no-expiry
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">EXP From</div>
                  <Input
                    type="date"
                    value={expFrom}
                    onChange={(e) => setExpFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">EXP To</div>
                  <Input
                    type="date"
                    value={expTo}
                    onChange={(e) => setExpTo(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFiltersOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={clearAllFilters}>
              Clear all
            </Button>
            <Button onClick={applyFilters}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Export Modal */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Export</DialogTitle>
            <DialogDescription>
              Choose what you want to export (CSV).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="text-sm font-medium">Options</div>
              <div className="text-xs text-muted-foreground mt-1">
                Uses <b>inventory_units.price</b> as unit_price.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setExportOpen(false);
                  exportCurrentPage();
                }}
                disabled={!product || loading}
              >
                Export Page ({units.length})
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setExportOpen(false);
                  exportFilteredAll();
                }}
                disabled={exporting || !product}
              >
                {exporting ? "Exporting…" : `Export Filtered (${totalCount})`}
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setExportOpen(false);
                  exportSelected();
                }}
                disabled={exporting || selectedIds.size === 0 || !product}
              >
                Export Selected ({selectedIds.size})
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✅ Bulk Edit Dialog */}
      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Bulk edit units</DialogTitle>
            <DialogDescription>
              Update status and/or dates in one action. Bulk setting to{" "}
              <b>SOLD</b> is disabled (needs customer details).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Scope</div>
              <Select
                value={bulkEditScope}
                onValueChange={(v) => setBulkEditScope(v as any)}
              >
                <SelectTrigger className="w-[260px]">
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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">New status</div>
                <Select
                  value={bulkNewStatus}
                  onValueChange={(v) =>
                    setBulkNewStatus(v as InventoryStatus | "NO_CHANGE")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    <SelectItem value="NO_CHANGE">No change</SelectItem>
                    <SelectItem value="IN_STOCK">IN_STOCK</SelectItem>
                    <SelectItem value="INVOICED">INVOICED</SelectItem>
                    <SelectItem value="DEMO">DEMO</SelectItem>
                    <SelectItem value="RETURNED">RETURNED</SelectItem>
                    {/* <SelectItem value="OUT_OF_STOCK">OUT_OF_STOCK</SelectItem> */}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  New manufacture date (leave empty = no change)
                </div>
                <Input
                  type="date"
                  value={bulkNewMfgDate}
                  onChange={(e) => setBulkNewMfgDate(e.target.value)}
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <div className="text-xs text-muted-foreground">
                  New expiry date (leave empty = no change)
                </div>
                <Input
                  type="date"
                  value={bulkNewExpDate}
                  onChange={(e) => setBulkNewExpDate(e.target.value)}
                />
                <div className="text-xs text-muted-foreground">
                  Note: this updates expiry_date to the given date. (No option
                  here to set expiry to null yet.)
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkEditOpen(false)}
              disabled={bulkEditing}
            >
              Cancel
            </Button>
            <Button onClick={runBulkEdit} disabled={bulkEditing}>
              {bulkEditing ? "Updating…" : "Apply changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="sm:max-w-[560px]">
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
              <SelectTrigger className="w-[260px]">
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
