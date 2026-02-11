// app/vendor/(protected)/invoices/[id]/edit/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const SUPPORT_EMAIL_FALLBACK = "info@madenkorea.com";

type TaxType = "CGST_SGST" | "IGST" | "NONE";

type InvoiceCompany = {
  id: string;
  display_name: string;
  address: string | null;
  gst_number: string | null;
  email: string | null;
};

type InvoiceRow = {
  id: string;
  company_id: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;

  customer_name: string;
  billing_address: string | null;
  phone: string | null;
  email: string | null;
  gst_number: string | null;
  pan_number: string | null;

  notes: string | null;

  subtotal?: number | null;
  discount_total?: number | null;

  tax_type?: TaxType | null;
  cgst_percent?: number | null;
  sgst_percent?: number | null;
  igst_percent?: number | null;

  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;

  tax_amount?: number | null;
  grand_total?: number | null;
  total_amount?: number | null;

  is_custom?: boolean | null;
  bill_to_address_id?: string | null;
};

type InvoiceItemRow = {
  id: string;
  product_id: string | null;
  brand: string | null;
  description: string;
  hsn: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  position: number | null;
};

type ProductSuggestion = {
  id: string;
  name: string;
  hsn: string | null;
  mrp: number | null;
  brandName: string | null;
};

type ScannedUnit = {
  unit_id: string;
  unit_code: string;
  product_id: string;
  product_name: string;
  brand_name: string;
  hsn: string;
  base_rate: number;
};

type LineOverride = { rate?: number; discount?: number };

type InvoiceLine = {
  product_id: string;
  description: string;
  brand: string;
  hsn: string;
  rate: number;
  qty: number;
  discount: number; // flat per line
  amount: number; // qty*rate - discount
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtINR = (v: any) =>
  inr.format(Number.isFinite(Number(v)) ? Number(v) : 0);

function toDateInputValue(d: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function createEmptyItem(): InvoiceItemRow {
  return {
    id: crypto.randomUUID(),
    product_id: null,
    brand: "",
    description: "",
    hsn: "",
    quantity: 1,
    unit_price: 0,
    discount: 0,
    position: null,
  };
}

export default function InvoiceEditPage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [company, setCompany] = useState<InvoiceCompany | null>(null);

  // manual items (custom invoices)
  const [items, setItems] = useState<InvoiceItemRow[]>([createEmptyItem()]);

  // Header fields
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  const [customerName, setCustomerName] = useState<string>("");
  const [billingAddress, setBillingAddress] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [gstNumber, setGstNumber] = useState<string>("");
  const [panNumber, setPanNumber] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Tax controls
  const [taxType, setTaxType] = useState<TaxType>("CGST_SGST");
  const [cgstPercent, setCgstPercent] = useState<number>(9);
  const [sgstPercent, setSgstPercent] = useState<number>(9);
  const [igstPercent, setIgstPercent] = useState<number>(18);

  // mode - DO NOT let user flip for safety; keep based on stored invoice flag
  const [isCustom, setIsCustom] = useState<boolean>(true);

  // manual suggestion UX (only used for manual web-generated invoices; but your flow is now scan-based)
  const [productSuggestionsByItem, setProductSuggestionsByItem] = useState<
    Record<string, ProductSuggestion[]>
  >({});
  const [activeSuggestForItemId, setActiveSuggestForItemId] = useState<
    string | null
  >(null);

  // scan-mode states
  const [scanCode, setScanCode] = useState("");
  const [scannedUnits, setScannedUnits] = useState<ScannedUnit[]>([]);
  const [lineOverrides, setLineOverrides] = useState<
    Record<string, LineOverride>
  >({});

  // refs to compute diff on save (revert removed units, sold added units)
  const originalUnitIdsRef = useRef<string[]>([]);

  const sellerName = company?.display_name || "—";
  const sellerEmail = company?.email || SUPPORT_EMAIL_FALLBACK;
  const sellerGstin = company?.gst_number || "—";

  const setLineRate = (productId: string, rate: number) => {
    setLineOverrides((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), rate },
    }));
  };

  const setLineDiscount = (productId: string, discount: number) => {
    setLineOverrides((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), discount },
    }));
  };

  // Load invoice + company + (items OR units)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!invoiceId) return;

      setLoading(true);
      setError(null);

      try {
        const { data: inv, error: invErr } = await supabase
          .from("invoices")
          .select(
            `
            id,
            company_id,
            invoice_number,
            invoice_date,
            due_date,
            customer_name,
            billing_address,
            phone,
            email,
            gst_number,
            pan_number,
            notes,
            subtotal,
            discount_total,
            tax_type,
            cgst_percent,
            sgst_percent,
            igst_percent,
            cgst_amount,
            sgst_amount,
            igst_amount,
            tax_amount,
            grand_total,
            total_amount,
            is_custom
          `,
          )
          .eq("id", invoiceId)
          .single();

        if (invErr || !inv)
          throw new Error(invErr?.message || "Invoice not found");
        if (cancelled) return;

        setInvoice(inv as InvoiceRow);

        setInvoiceDate(toDateInputValue(inv.invoice_date ?? null));
        setDueDate(toDateInputValue(inv.due_date ?? null));

        setCustomerName(inv.customer_name ?? "");
        setBillingAddress(inv.billing_address ?? "");
        setPhone(inv.phone ?? "");
        setEmail(inv.email ?? "");
        setGstNumber(inv.gst_number ?? "");
        setPanNumber(inv.pan_number ?? "");
        setNotes(inv.notes ?? "");

        const tt = ((inv as any).tax_type ?? "CGST_SGST") as TaxType;
        setTaxType(tt);
        setCgstPercent(Number((inv as any).cgst_percent ?? 9));
        setSgstPercent(Number((inv as any).sgst_percent ?? 9));
        setIgstPercent(Number((inv as any).igst_percent ?? 18));

        const customFlag = Boolean((inv as any).is_custom ?? true);
        setIsCustom(customFlag);

        // Company
        const { data: c } = await supabase
          .from("invoice_companies")
          .select("id,display_name,address,gst_number,email")
          .eq("id", (inv as any).company_id)
          .single();

        if (!cancelled) setCompany((c || null) as InvoiceCompany | null);

        // Always load invoice_items (needed to restore overrides even in scan-mode)
        const { data: its, error: itsErr } = await supabase
          .from("invoice_items")
          .select(
            "id,product_id,brand,description,hsn,quantity,unit_price,discount,position",
          )
          .eq("invoice_id", invoiceId)
          .order("position", { ascending: true });

        if (itsErr) throw new Error(itsErr.message || "Failed to load items");

        const mappedItems = ((its || []) as InvoiceItemRow[]).map((it) => ({
          ...it,
          brand: it.brand ?? "",
          hsn: it.hsn ?? "",
          quantity: Number(it.quantity ?? 0),
          unit_price: Number(it.unit_price ?? 0),
          discount: Number(it.discount ?? 0),
        }));

        // If custom invoice -> use manual items UI
        if (customFlag) {
          if (!cancelled) setItems(mappedItems.length ? mappedItems : [createEmptyItem()]);
          if (!cancelled) {
            setScannedUnits([]);
            setLineOverrides({});
            originalUnitIdsRef.current = [];
          }
          return;
        }

        // Scan-mode invoice: load invoice_units
        const { data: iUnits, error: iuErr } = await supabase
          .from("invoice_units")
          .select(
            `
            unit_id,
            unit_code,
            product_id,
            products:products(
              id,
              name,
              hsn,
              compare_at_price,
              price,
              brands:brands(name)
            )
          `,
          )
          .eq("invoice_id", invoiceId);

        if (iuErr) throw new Error(iuErr.message || "Failed to load invoice units");

        const builtUnits: ScannedUnit[] = (iUnits || []).map((r: any) => {
          const p = r.products;
          const brandName = p?.brands?.name ?? "";
          const baseRate = Number(p?.compare_at_price ?? p?.price ?? 0);
          return {
            unit_id: r.unit_id,
            unit_code: r.unit_code,
            product_id: r.product_id,
            product_name: p?.name ?? "",
            brand_name: brandName,
            hsn: p?.hsn ?? "",
            base_rate: baseRate,
          };
        });

        // restore overrides from invoice_items (unit_price + discount)
        const ov: Record<string, LineOverride> = {};
        for (const it of mappedItems) {
          if (!it.product_id) continue;
          ov[it.product_id] = {
            rate: Number(it.unit_price ?? 0),
            discount: Number(it.discount ?? 0),
          };
        }

        if (!cancelled) {
          setItems([createEmptyItem()]); // not used in scan-mode
          setScannedUnits(builtUnits);
          setLineOverrides(ov);
          originalUnitIdsRef.current = builtUnits.map((u) => u.unit_id);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load invoice");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  // ===== CUSTOM MODE calculations =====
  const customTotals = useMemo(() => {
    let sub = 0;
    let disc = 0;

    for (const item of items) {
      const lineBase = Number(item.quantity || 0) * Number(item.unit_price || 0);
      sub += lineBase;
      disc += Number(item.discount || 0);
    }
    const taxable = sub - disc;

    return {
      subtotal: Number(sub.toFixed(2)),
      discountTotal: Number(disc.toFixed(2)),
      taxableAmount: Number(taxable.toFixed(2)),
    };
  }, [items]);

  // ===== SCAN MODE: group scannedUnits -> lines (qty auto), rate+discount editable =====
  const scannedLines: InvoiceLine[] = useMemo(() => {
    const map = new Map<string, InvoiceLine>();

    for (const u of scannedUnits) {
      const ov = lineOverrides[u.product_id] || {};
      const rate = Number.isFinite(Number(ov.rate)) ? Number(ov.rate) : u.base_rate;
      const discount = Number.isFinite(Number(ov.discount)) ? Number(ov.discount) : 0;

      const existing = map.get(u.product_id);
      if (!existing) {
        const qty = 1;
        const amount = qty * rate - discount;
        map.set(u.product_id, {
          product_id: u.product_id,
          description: u.product_name,
          brand: u.brand_name,
          hsn: u.hsn,
          rate,
          qty,
          discount,
          amount: Number(amount.toFixed(2)),
        });
      } else {
        const qty = existing.qty + 1;
        const amount = qty * rate - discount;
        map.set(u.product_id, {
          ...existing,
          rate,
          qty,
          discount,
          amount: Number(amount.toFixed(2)),
        });
      }
    }

    return Array.from(map.values());
  }, [scannedUnits, lineOverrides]);

  const scanTotals = useMemo(() => {
    let sub = 0;
    let disc = 0;

    for (const l of scannedLines) {
      sub += l.qty * l.rate;
      disc += Number(l.discount || 0);
    }
    const taxable = sub - disc;

    return {
      subtotal: Number(sub.toFixed(2)),
      discountTotal: Number(disc.toFixed(2)),
      taxableAmount: Number(taxable.toFixed(2)),
    };
  }, [scannedLines]);

  const activeTotals = isCustom ? customTotals : scanTotals;

  const { cgstAmount, sgstAmount, igstAmount, taxTotal, grandTotal } = useMemo(() => {
    const taxable = activeTotals.taxableAmount;

    const cgst = taxType === "CGST_SGST" ? (taxable * cgstPercent) / 100 : 0;
    const sgst = taxType === "CGST_SGST" ? (taxable * sgstPercent) / 100 : 0;
    const igst = taxType === "IGST" ? (taxable * igstPercent) / 100 : 0;

    const tax = cgst + sgst + igst;
    const grand = taxable + tax;

    return {
      cgstAmount: Number(cgst.toFixed(2)),
      sgstAmount: Number(sgst.toFixed(2)),
      igstAmount: Number(igst.toFixed(2)),
      taxTotal: Number(tax.toFixed(2)),
      grandTotal: Number(grand.toFixed(2)),
    };
  }, [activeTotals.taxableAmount, taxType, cgstPercent, sgstPercent, igstPercent]);

  // ===== Custom item ops =====
  const updateItem = (id: string, patch: Partial<InvoiceItemRow>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };
  const addItem = () => setItems((prev) => [...prev, createEmptyItem()]);
  const removeItem = (id: string) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)));

  // suggestions (kept; not used in scan flow)
  const fetchProductSuggestions = async (itemId: string, query: string) => {
    if (isCustom) return;

    const q = query.trim();
    if (q.length < 2) {
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

    const { data, error } = await supabase
      .from("products")
      .select("id,name,hsn,compare_at_price,price,brands:brands(name)")
      .ilike("name", `%${q}%`)
      .limit(10);

    if (error) {
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

    const mapped: ProductSuggestion[] = (data || []).map((p: any) => {
      const mrp =
        p.compare_at_price != null
          ? Number(p.compare_at_price)
          : p.price != null
            ? Number(p.price)
            : null;

      return {
        id: p.id,
        name: p.name,
        hsn: p.hsn ?? null,
        mrp,
        brandName: p.brands?.name ?? null,
      };
    });

    setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: mapped }));
  };

  // ===== Scan operations =====
  async function addUnitByCode(unitCodeRaw: string) {
    const unitCode = unitCodeRaw.trim();
    if (!unitCode) return;

    if (scannedUnits.some((u) => u.unit_code === unitCode)) return;

    setError(null);

    const { data: unit, error: unitErr } = await supabase
      .from("inventory_units")
      .select("id, unit_code, status, product_id")
      .eq("unit_code", unitCode)
      .maybeSingle();

    if (unitErr) throw unitErr;
    if (!unit) return setError("Unit not found.");
    if ((unit.status || "").toUpperCase() !== "IN_STOCK") {
      return setError("Unit is not IN_STOCK (already sold/blocked).");
    }

    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("id, name, hsn, compare_at_price, price, brands:brands(name)")
      .eq("id", unit.product_id)
      .maybeSingle();

    if (prodErr) throw prodErr;
    if (!product) return setError("Product not found for unit.");

    const brandName = (product as any)?.brands?.name || "";
    const baseRate = Number(product.compare_at_price ?? product.price ?? 0);

    setScannedUnits((prev) => [
      ...prev,
      {
        unit_id: unit.id,
        unit_code: unit.unit_code,
        product_id: product.id,
        product_name: product.name ?? "",
        brand_name: brandName,
        hsn: product.hsn ?? "",
        base_rate: baseRate,
      },
    ]);

    setScanCode("");
  }

  function removeUnit(unitCode: string) {
    setScannedUnits((prev) => prev.filter((u) => u.unit_code !== unitCode));
  }

  function removeProductLine(productId: string) {
    setScannedUnits((prev) => prev.filter((u) => u.product_id !== productId));
  }

  // ===== Save =====
  const handleSave = async () => {
    setError(null);
    if (!invoice) return;

    if (!customerName.trim()) return setError("Please enter customer name.");
    if (!billingAddress.trim()) return setError("Please enter billing address.");
    if (!phone.trim()) return setError("Please enter customer mobile number.");

    if (isCustom) {
      if (items.every((it) => !it.description.trim()))
        return setError("Please enter at least one line item description.");
    } else {
      if (scannedUnits.length === 0) return setError("Scan at least one unit.");
    }

    setSaving(true);

    try {
      // 1) Update invoice header + totals
      const { error: upErr } = await supabase
        .from("invoices")
        .update({
          invoice_date: invoiceDate || null,
          due_date: dueDate || null,

          customer_name: customerName,
          billing_address: billingAddress || null,
          phone: phone || null,
          email: email || null,
          gst_number: gstNumber || null,
          pan_number: panNumber || null,

          notes: notes || null,

          subtotal: activeTotals.subtotal,
          discount_total: activeTotals.discountTotal,

          tax_type: taxType,
          cgst_percent: taxType === "CGST_SGST" ? cgstPercent : 0,
          sgst_percent: taxType === "CGST_SGST" ? sgstPercent : 0,
          igst_percent: taxType === "IGST" ? igstPercent : 0,

          cgst_amount: cgstAmount,
          sgst_amount: sgstAmount,
          igst_amount: igstAmount,

          tax_amount: taxTotal,
          grand_total: grandTotal,
          total_amount: grandTotal,
          is_custom: isCustom,
        })
        .eq("id", invoiceId);

      if (upErr) throw new Error(upErr.message || "Failed to update invoice");

      // ===== Custom save (your existing behavior) =====
      if (isCustom) {
        const { error: delErr } = await supabase
          .from("invoice_items")
          .delete()
          .eq("invoice_id", invoiceId);

        if (delErr) throw new Error(delErr.message || "Failed to refresh invoice items");

        const itemsToInsert = items
          .filter((it) => it.description.trim())
          .map((it, index) => {
            const lineSubtotal =
              Number(it.quantity || 0) * Number(it.unit_price || 0) - Number(it.discount || 0);

            return {
              invoice_id: invoiceId,
              product_id: it.product_id ?? null,
              brand: (it.brand || "").trim() ? it.brand : null,
              description: it.description,
              hsn: (it.hsn || "").trim() ? it.hsn : null,
              quantity: Number(it.quantity || 0),
              unit_price: Number(it.unit_price || 0),
              discount: Number(it.discount || 0),
              line_subtotal: Number(lineSubtotal.toFixed(2)),
              line_total: Number(lineSubtotal.toFixed(2)),
              position: index,
            };
          });

        if (itemsToInsert.length) {
          const { error: insErr } = await supabase.from("invoice_items").insert(itemsToInsert);
          if (insErr) throw new Error(insErr.message || "Failed to save invoice items");
        }

        router.push(`/vendor/invoices/${invoiceId}`);
        return;
      }

      // ===== Scan-mode save: revert removed units and mark added units =====
      const original = new Set(originalUnitIdsRef.current);
      const current = new Set(scannedUnits.map((u) => u.unit_id));

      const removedUnitIds = Array.from(original).filter((id) => !current.has(id));
      const addedUnitIds = Array.from(current).filter((id) => !original.has(id));

if (removedUnitIds.length > 0) {
  const { error: revErr } = await supabase
    .from("inventory_units")
    .update({
      status: "IN_STOCK",
      sold_at: null,
      sold_invoice_id: null,
      sold_customer_id: null,
      sold_customer_address: null,
    })
    .in("id", removedUnitIds)
    .eq("sold_invoice_id", invoiceId);

  if (revErr) throw new Error(revErr.message || "Failed to revert removed units");
}

      if (addedUnitIds.length > 0) {
        const { error: soldErr } = await supabase
          .from("inventory_units")
          .update({
            status: "SOLD",
            sold_at: new Date().toISOString(),
            sold_invoice_id: invoiceId,
          })
          .in("id", addedUnitIds)
          .eq("status", "IN_STOCK");

        if (soldErr) throw new Error(soldErr.message || "Failed to mark added units SOLD");
      }

      // Replace invoice_units
      const { error: delIU } = await supabase
        .from("invoice_units")
        .delete()
        .eq("invoice_id", invoiceId);
      if (delIU) throw new Error(delIU.message || "Failed to refresh invoice units");

      const { error: insIU } = await supabase.from("invoice_units").insert(
        scannedUnits.map((u) => ({
          invoice_id: invoiceId,
          unit_id: u.unit_id,
          unit_code: u.unit_code,
          product_id: u.product_id,
        })),
      );
      if (insIU) throw new Error(insIU.message || "Failed to save invoice units");

      // Replace invoice_items from grouped scannedLines (editable rate/discount)
      const { error: delItems } = await supabase
        .from("invoice_items")
        .delete()
        .eq("invoice_id", invoiceId);
      if (delItems) throw new Error(delItems.message || "Failed to refresh invoice items");

      const { error: insItems } = await supabase.from("invoice_items").insert(
        scannedLines.map((l, index) => {
          const lineSubtotal = l.qty * l.rate - l.discount;
          return {
            invoice_id: invoiceId,
            product_id: l.product_id,
            brand: l.brand || null,
            description: l.description,
            hsn: l.hsn || null,
            quantity: l.qty,
            unit_price: l.rate,
            discount: l.discount,
            line_subtotal: Number(lineSubtotal.toFixed(2)),
            line_total: Number(lineSubtotal.toFixed(2)),
            position: index,
          };
        }),
      );
      if (insItems) throw new Error(insItems.message || "Failed to save invoice items");

      // update original set for next save
      originalUnitIdsRef.current = scannedUnits.map((u) => u.unit_id);

      router.push(`/vendor/invoices/${invoiceId}`);
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-10 text-sm text-muted-foreground">
        Loading invoice…
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="container mx-auto py-10">
        <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
        <div className="mt-4">
          <Button variant="outline" onClick={() => router.push("/vendor/invoices")}>
            ← Back to Invoices
          </Button>
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => router.push(`/vendor/invoices/${invoiceId}`)}>
          ← Back to Invoice
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Edit Invoice</CardTitle>
          <CardDescription>
            Invoice No: <span className="font-medium">{invoice.invoice_number}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Seller preview */}
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-medium">{sellerName}</div>
            <div className="text-xs text-muted-foreground">
              Support: {sellerEmail} • GSTIN: {sellerGstin}
            </div>
          </div>

          {/* Invoice meta */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Invoice Number</Label>
              <Input value={invoice.invoice_number} disabled />
              <p className="text-xs text-muted-foreground">Auto generated (not editable).</p>
            </div>

            <div className="space-y-1">
              <Label>Invoice Date</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* Mode (locked) */}
          <div className="rounded-md border p-3 flex items-center justify-between">
            <div className="text-sm font-medium">
              Mode: {isCustom ? "Custom (Manual Items)" : "Web-generated (Scan Units)"}
            </div>
            <div className="text-xs text-muted-foreground">
              Mode is locked for this invoice.
            </div>
          </div>

          {/* Customer */}
          <div className="border-t pt-4">
            <h3 className="mb-2 text-base font-semibold">Customer Details</h3>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Customer Name</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Customer Email (optional)</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>Mobile Number</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>GST No (Customer)</Label>
                <Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label>PAN Number (Customer)</Label>
                <Input value={panNumber} onChange={(e) => setPanNumber(e.target.value)} />
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <Label>Billing Address</Label>
              <Textarea value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} rows={3} />
            </div>
          </div>

          {/* Scan section */}
          {!isCustom && (
            <div className="border-t pt-4 space-y-3">
              <h3 className="text-base font-semibold">Units</h3>

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium">Scan Unit QR / Unit Code</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-2"
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                    placeholder="Scan or paste unit_code and press Enter"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addUnitByCode(scanCode);
                    }}
                  />
                </div>
                <button type="button" className="border rounded px-4 py-2" onClick={() => addUnitByCode(scanCode)}>
                  Add
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {scannedUnits.map((u) => (
                  <span
                    key={u.unit_code}
                    className="text-xs border rounded px-2 py-1 flex items-center gap-2"
                    title={`${u.product_name} • ${u.brand_name}`}
                  >
                    {u.unit_code}
                    <button type="button" className="text-red-600" onClick={() => removeUnit(u.unit_code)}>
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Removing a unit here will revert it to IN_STOCK when you save.
              </p>
            </div>
          )}

          {/* Items */}
          <div className="border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Invoice Items</h3>

              {isCustom ? (
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  + Add Item
                </Button>
              ) : (
                <div className="text-xs text-muted-foreground">Items are generated from scanned units</div>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-2 py-2 text-left w-[60px]">Sl.No</th>
                    <th className="px-2 py-2 text-left">Brand</th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-left w-[120px]">HSN</th>
                    <th className="px-2 py-2 text-right w-[90px]">Qty</th>
                    <th className="px-2 py-2 text-right w-[120px]">MRP</th>
                    <th className="px-2 py-2 text-right w-[120px]">Discount</th>
                    <th className="px-2 py-2 text-right w-[140px]">Amount</th>
                    <th className="px-2 py-2 text-center w-[90px] print:hidden">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {isCustom ? (
                    items.map((item, idx) => {
                      const lineAmount =
                        Number(item.quantity || 0) * Number(item.unit_price || 0) - Number(item.discount || 0);

                      return (
                        <tr key={item.id} className="border-t align-top">
                          <td className="px-2 py-2">{idx + 1}</td>

                          <td className="px-2 py-2">
                            <Input
                              value={item.brand ?? ""}
                              onChange={(e) => updateItem(item.id, { brand: e.target.value })}
                              placeholder="Brand"
                            />
                          </td>

                          <td className="px-2 py-2 relative">
                            <Input
                              value={item.description}
                              onFocus={() => !isCustom && setActiveSuggestForItemId(item.id)}
                              onBlur={() => {
                                setTimeout(() => {
                                  setActiveSuggestForItemId((prev) => (prev === item.id ? null : prev));
                                  setProductSuggestionsByItem((prev) => ({ ...prev, [item.id]: [] }));
                                }, 150);
                              }}
                              onChange={(e) => {
                                const v = e.target.value;

                                updateItem(item.id, {
                                  description: v,
                                  product_id: isCustom ? item.product_id : null,
                                });

                                if (!isCustom) {
                                  setActiveSuggestForItemId(item.id);
                                  fetchProductSuggestions(item.id, v);
                                }
                              }}
                              placeholder={isCustom ? "Product name" : "Search website product..."}
                            />

                            {!isCustom &&
                              activeSuggestForItemId === item.id &&
                              (productSuggestionsByItem[item.id]?.length || 0) > 0 && (
                                <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-sm max-h-60 overflow-auto">
                                  {productSuggestionsByItem[item.id].map((p: any) => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-3"
                                      onMouseDown={(ev) => ev.preventDefault()}
                                      onClick={() => {
                                        updateItem(item.id, {
                                          description: p.name,
                                          product_id: p.id,
                                          brand: p.brandName ?? "",
                                          hsn: p.hsn ?? "",
                                          unit_price: p.mrp ?? 0,
                                        });

                                        setProductSuggestionsByItem((prev) => ({ ...prev, [item.id]: [] }));
                                        setActiveSuggestForItemId(null);
                                      }}
                                    >
                                      <span className="truncate">{p.name}</span>
                                      <span className="text-xs text-slate-600">
                                        {p.mrp != null ? fmtINR(p.mrp) : ""}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                          </td>

                          <td className="px-2 py-2">
                            <Input
                              value={item.hsn ?? ""}
                              onChange={(e) => updateItem(item.id, { hsn: e.target.value })}
                              placeholder="HSN"
                            />
                          </td>

                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              value={String(item.quantity)}
                              onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })}
                            />
                          </td>

                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(item.unit_price)}
                              onChange={(e) => updateItem(item.id, { unit_price: Number(e.target.value) || 0 })}
                            />
                          </td>

                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(item.discount)}
                              onChange={(e) => updateItem(item.id, { discount: Number(e.target.value) || 0 })}
                            />
                          </td>

                          <td className="px-2 py-2 text-right font-medium">{fmtINR(lineAmount)}</td>

                          <td className="px-2 py-2 text-center print:hidden">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeItem(item.id)}
                              disabled={items.length <= 1}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    scannedLines.map((l, idx) => (
                      <tr key={l.product_id} className="border-t align-top">
                        <td className="px-2 py-2">{idx + 1}</td>

                        <td className="px-2 py-2">
                          <Input value={l.brand} disabled />
                        </td>

                        <td className="px-2 py-2">
                          <Input value={l.description} disabled />
                        </td>

                        <td className="px-2 py-2">
                          <Input value={l.hsn} disabled />
                        </td>

                        <td className="px-2 py-2">
                          <Input value={String(l.qty)} disabled />
                        </td>

                        {/* ✅ Editable MRP */}
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(l.rate)}
                            onChange={(e) => setLineRate(l.product_id, Number(e.target.value) || 0)}
                          />
                        </td>

                        {/* ✅ Editable Discount */}
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(Number(lineOverrides[l.product_id]?.discount ?? l.discount ?? 0))}
                            onChange={(e) => setLineDiscount(l.product_id, Number(e.target.value) || 0)}
                          />
                        </td>

                        <td className="px-2 py-2 text-right font-medium">{fmtINR(l.amount)}</td>

                        <td className="px-2 py-2 text-center print:hidden">
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeProductLine(l.product_id)}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-4 flex flex-col items-end space-y-1 text-sm">
              <div className="flex w-full max-w-sm justify-between">
                <span>Subtotal</span>
                <span>{fmtINR(activeTotals.subtotal)}</span>
              </div>

              <div className="flex w-full max-w-sm justify-between">
                <span>Discount</span>
                <span>{fmtINR(activeTotals.discountTotal)}</span>
              </div>

              <div className="flex w-full max-w-sm justify-between">
                <span className="text-muted-foreground">Taxable Amount</span>
                <span className="font-medium">{fmtINR(activeTotals.taxableAmount)}</span>
              </div>

              {taxType === "CGST_SGST" && (
                <>
                  <div className="flex w-full max-w-sm justify-between">
                    <span>CGST</span>
                    <span>{fmtINR(cgstAmount)}</span>
                  </div>
                  <div className="flex w-full max-w-sm justify-between">
                    <span>SGST</span>
                    <span>{fmtINR(sgstAmount)}</span>
                  </div>
                </>
              )}

              {taxType === "IGST" && (
                <div className="flex w-full max-w-sm justify-between">
                  <span>IGST</span>
                  <span>{fmtINR(igstAmount)}</span>
                </div>
              )}

              <div className="flex w-full max-w-sm justify-between font-semibold border-t pt-2 mt-2">
                <span>Invoice Amount</span>
                <span>{fmtINR(grandTotal)}</span>
              </div>
            </div>

            {/* Tax config */}
            <div className="mt-4 w-full max-w-sm rounded-md border p-3 text-sm">
              <div className="font-semibold mb-2">Tax</div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Type</span>
                <select
                  value={taxType}
                  onChange={(e) => setTaxType(e.target.value as TaxType)}
                  className="border rounded-md px-2 py-1 text-sm"
                >
                  <option value="CGST_SGST">CGST + SGST</option>
                  <option value="IGST">IGST</option>
                  <option value="NONE">No Tax</option>
                </select>
              </div>

              {taxType === "CGST_SGST" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">CGST %</div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={cgstPercent.toString()}
                      onChange={(e) => setCgstPercent(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">SGST %</div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={sgstPercent.toString()}
                      onChange={(e) => setSgstPercent(Number(e.target.value) || 0)}
                    />
                  </div>
                </div>
              )}

              {taxType === "IGST" && (
                <div className="mt-2">
                  <div className="text-xs text-muted-foreground mb-1">IGST %</div>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={igstPercent.toString()}
                    onChange={(e) => setIgstPercent(Number(e.target.value) || 0)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="border-t pt-4">
            <div className="space-y-1">
              <Label>Notes / Internal Reference</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
