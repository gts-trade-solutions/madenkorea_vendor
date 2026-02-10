// app/vendor/(protected)/invoices/[id]/edit/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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

  // optional flags you may have
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
  unit_price: number; // we use this as MRP now
  discount: number;
  position: number | null;
};

type ProductSuggestion = {
  id: string;
  name: string;
  hsn: string | null;
  mrp: number | null; // compare_at_price (fallback to price)
  brandName: string | null;
};

function formatINR(value: number) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `₹${Number(value || 0).toFixed(2)}`;
  }
}

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
  const [items, setItems] = useState<InvoiceItemRow[]>([createEmptyItem()]);

  // Form fields
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  const [customerName, setCustomerName] = useState<string>("");
  const [billingAddress, setBillingAddress] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [gstNumber, setGstNumber] = useState<string>("");
  const [panNumber, setPanNumber] = useState<string>("");

  const [notes, setNotes] = useState<string>("");

  // Tax controls (stored on invoice)
  const [taxType, setTaxType] = useState<TaxType>("CGST_SGST");
  const [cgstPercent, setCgstPercent] = useState<number>(9);
  const [sgstPercent, setSgstPercent] = useState<number>(9);
  const [igstPercent, setIgstPercent] = useState<number>(18);

  // Product search UX (same as "new" page)
  const [isCustom, setIsCustom] = useState<boolean>(true);
  const [productSuggestionsByItem, setProductSuggestionsByItem] = useState<
    Record<string, ProductSuggestion[]>
  >({});
  const [activeSuggestForItemId, setActiveSuggestForItemId] = useState<
    string | null
  >(null);

  // Load invoice + company + items
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
            is_custom,
            bill_to_address_id
          `,
          )
          .eq("id", invoiceId)
          .single();

        if (invErr || !inv)
          throw new Error(invErr?.message || "Invoice not found");
        if (cancelled) return;

        setInvoice(inv as InvoiceRow);

        // Set form state
        setInvoiceDate(toDateInputValue((inv as any).invoice_date ?? null));
        setDueDate(toDateInputValue((inv as any).due_date ?? null));

        setCustomerName((inv as any).customer_name ?? "");
        setBillingAddress((inv as any).billing_address ?? "");
        setPhone((inv as any).phone ?? "");
        setEmail((inv as any).email ?? "");
        setGstNumber((inv as any).gst_number ?? "");
        setPanNumber((inv as any).pan_number ?? "");
        setNotes((inv as any).notes ?? "");

        const tt = ((inv as any).tax_type ?? "CGST_SGST") as TaxType;
        setTaxType(tt);
        setCgstPercent(Number((inv as any).cgst_percent ?? 9));
        setSgstPercent(Number((inv as any).sgst_percent ?? 9));
        setIgstPercent(Number((inv as any).igst_percent ?? 18));

        setIsCustom(Boolean((inv as any).is_custom ?? true));

        // Company
        const { data: c } = await supabase
          .from("invoice_companies")
          .select("id,display_name,address,gst_number,email")
          .eq("id", (inv as any).company_id)
          .single();

        if (!cancelled) setCompany((c || null) as InvoiceCompany | null);

        // Items
        const { data: its, error: itsErr } = await supabase
          .from("invoice_items")
          .select(
            "id,product_id,brand,description,hsn,quantity,unit_price,discount,position",
          )
          .eq("invoice_id", invoiceId)
          .order("position", { ascending: true });

        if (itsErr) throw new Error(itsErr.message || "Failed to load items");

        const mapped = ((its || []) as InvoiceItemRow[]).map((it) => ({
          ...it,
          brand: it.brand ?? "",
          hsn: it.hsn ?? "",
          quantity: Number(it.quantity ?? 0),
          unit_price: Number(it.unit_price ?? 0),
          discount: Number(it.discount ?? 0),
        }));

        if (!cancelled) setItems(mapped.length ? mapped : [createEmptyItem()]);
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

  const sellerName = company?.display_name || "—";
  const sellerEmail = company?.email || SUPPORT_EMAIL_FALLBACK;
  const sellerGstin = company?.gst_number || "—";

  // Calculations (MRP-only: unit_price is the MRP)
  const { subtotal, discountTotal, taxableAmount } = useMemo(() => {
    let sub = 0;
    let disc = 0;

    for (const item of items) {
      const lineBase =
        Number(item.quantity || 0) * Number(item.unit_price || 0);
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

  const { cgstAmount, sgstAmount, igstAmount, taxTotal, grandTotal } =
    useMemo(() => {
      const taxable = taxableAmount;

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
    }, [taxableAmount, taxType, cgstPercent, sgstPercent, igstPercent]);

  const updateItem = (id: string, patch: Partial<InvoiceItemRow>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  };

  const addItem = () => setItems((prev) => [...prev, createEmptyItem()]);
  const removeItem = (id: string) =>
    setItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((it) => it.id !== id),
    );

  // Fetch suggestions (brand via brands(name))
  const fetchProductSuggestions = async (itemId: string, query: string) => {
    if (isCustom) return;

    const q = query.trim();
    if (q.length < 2) {
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

    // NOTE:
    // - Uses products.brand_id -> brands.id relationship
    // - Uses products.hsn if exists; otherwise returns null
    const { data, error } = await supabase
      .from("products")
      .select("id,name,hsn,compare_at_price,price,brand_id,brands(name)")
      .ilike("name", `%${q}%`)
      .limit(10);

    if (error) {
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

    const mapped: ProductSuggestion[] = (data || []).map((p: any) => {
      const brandName =
        (Array.isArray(p.brands) ? p.brands?.[0]?.name : p.brands?.name) ??
        null;

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
        brandName,
      };
    });

    setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: mapped }));
  };

  const handleSave = async () => {
    setError(null);

    if (!invoice) return;
    if (!customerName.trim()) return setError("Please enter customer name.");
    if (!billingAddress.trim())
      return setError("Please enter billing address.");
    if (!phone.trim()) return setError("Please enter customer mobile number.");
    if (items.every((it) => !it.description.trim()))
      return setError("Please enter at least one line item description.");

    // If web-generated mode, enforce product_id
    if (!isCustom) {
      const invalid = items
        .filter((it) => it.description.trim())
        .some((it) => !it.product_id);
      if (invalid) {
        return setError(
          "Web generated invoice: please select product names from suggestions for all items.",
        );
      }
    }

    setSaving(true);

    try {
      // 1) Update invoice (invoice_number NOT editable)
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

          // totals
          subtotal,
          discount_total: discountTotal,

          // tax
          tax_type: taxType,
          cgst_percent: taxType === "CGST_SGST" ? cgstPercent : 0,
          sgst_percent: taxType === "CGST_SGST" ? sgstPercent : 0,
          igst_percent: taxType === "IGST" ? igstPercent : 0,

          cgst_amount: cgstAmount,
          sgst_amount: sgstAmount,
          igst_amount: igstAmount,

          tax_amount: taxTotal,
          grand_total: grandTotal,
          total_amount: grandTotal, // backward compatible

          // flags
          is_custom: isCustom,
        })
        .eq("id", invoiceId);

      if (upErr) throw new Error(upErr.message || "Failed to update invoice");

      // 2) Replace items (simple + reliable)
      //    - delete all items and re-insert in order
      const { error: delErr } = await supabase
        .from("invoice_items")
        .delete()
        .eq("invoice_id", invoiceId);

      if (delErr)
        throw new Error(delErr.message || "Failed to refresh invoice items");

      const itemsToInsert = items
        .filter((it) => it.description.trim())
        .map((it, index) => {
          const lineSubtotal =
            Number(it.quantity || 0) * Number(it.unit_price || 0) -
            Number(it.discount || 0);
          return {
            invoice_id: invoiceId,
            product_id: it.product_id ?? null,
            brand: (it.brand || "").trim() ? it.brand : null,
            description: it.description,
            hsn: (it.hsn || "").trim() ? it.hsn : null,
            quantity: Number(it.quantity || 0),
            unit_price: Number(it.unit_price || 0), // MRP
            discount: Number(it.discount || 0),
            line_subtotal: Number(lineSubtotal.toFixed(2)),
            line_total: Number(lineSubtotal.toFixed(2)),
            position: index,
          };
        });

      if (itemsToInsert.length) {
        const { error: insErr } = await supabase
          .from("invoice_items")
          .insert(itemsToInsert);
        if (insErr)
          throw new Error(insErr.message || "Failed to save invoice items");
      }

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
          <Button
            variant="outline"
            onClick={() => router.push("/vendor/invoices")}
          >
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
        <Button
          variant="outline"
          onClick={() => router.push(`/vendor/invoices/${invoiceId}`)}
        >
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
            Invoice No:{" "}
            <span className="font-medium">{invoice.invoice_number}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Seller preview (read-only) */}
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
              <p className="text-xs text-muted-foreground">
                Auto generated (not editable).
              </p>
            </div>

            <div className="space-y-1">
              <Label>Invoice Date</Label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Mode */}
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between rounded-md border p-3">
            <div className="flex items-center gap-3">
              <input
                id="is_custom"
                type="checkbox"
                checked={isCustom}
                onChange={(e) => {
                  const next = e.target.checked;
                  setIsCustom(next);

                  // When switching to web mode, clear product_id so user must reselect
                  setItems((prev) =>
                    prev.map((it) => ({
                      ...it,
                      product_id: next ? it.product_id : it.product_id,
                    })),
                  );
                  setProductSuggestionsByItem({});
                  setActiveSuggestForItemId(null);
                }}
                className="h-4 w-4"
              />
              <label htmlFor="is_custom" className="text-sm font-medium">
                Custom Invoice (manual items)
              </label>
            </div>

            <div className="text-xs text-muted-foreground">
              {isCustom
                ? "You can type any item name and MRP."
                : "Type to search website products. Select from suggestions to auto-fill Brand & HSN. MRP can still be edited."}
            </div>
          </div>

          {/* Customer */}
          <div className="border-t pt-4">
            <h3 className="mb-2 text-base font-semibold">Customer Details</h3>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Customer Name</Label>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Customer Email (optional)</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Mobile Number</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>GST No (Customer)</Label>
                <Input
                  value={gstNumber}
                  onChange={(e) => setGstNumber(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>PAN Number (Customer)</Label>
                <Input
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <Label>Billing Address</Label>
              <Textarea
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          {/* Items */}
          <div className="border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold">Invoice Items</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItem}
              >
                + Add Item
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-2 py-2 text-left w-[60px]">Sl.No</th>
                    <th className="px-2 py-2 text-left w-[180px]">Brand</th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-left w-[120px]">HSN</th>
                    <th className="px-2 py-2 text-right w-[90px]">Qty</th>
                    <th className="px-2 py-2 text-right w-[140px]">MRP</th>
                    <th className="px-2 py-2 text-right w-[140px]">Discount</th>
                    <th className="px-2 py-2 text-right w-[140px]">Amount</th>
                    <th className="px-2 py-2 text-center w-[90px] print:hidden">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {items.map((item, idx) => {
                    const lineAmount =
                      Number(item.quantity || 0) *
                        Number(item.unit_price || 0) -
                      Number(item.discount || 0);

                    return (
                      <tr key={item.id} className="border-t align-top">
                        <td className="px-2 py-2">{idx + 1}</td>

                        {/* Brand (auto-filled when selecting product; still editable) */}
                        <td className="px-2 py-2">
                          <Input
                            value={item.brand || ""}
                            onChange={(e) =>
                              updateItem(item.id, { brand: e.target.value })
                            }
                            placeholder="Brand"
                          />
                        </td>

                        {/* Description + suggestions in web mode */}
                        <td className="px-2 py-2 relative">
                          <Input
                            value={item.description}
                            onFocus={() =>
                              !isCustom && setActiveSuggestForItemId(item.id)
                            }
                            onBlur={() => {
                              setTimeout(() => {
                                setActiveSuggestForItemId((prev) =>
                                  prev === item.id ? null : prev,
                                );
                                setProductSuggestionsByItem((prev) => ({
                                  ...prev,
                                  [item.id]: [],
                                }));
                              }, 150);
                            }}
                            onChange={(e) => {
                              const v = e.target.value;

                              if (isCustom) {
                                updateItem(item.id, { description: v });
                                return;
                              }

                              updateItem(item.id, {
                                description: v,
                                product_id: null,
                              });
                              setActiveSuggestForItemId(item.id);
                              fetchProductSuggestions(item.id, v);
                            }}
                            placeholder={
                              isCustom
                                ? "Product name"
                                : "Search website product..."
                            }
                          />

                          {!isCustom &&
                            activeSuggestForItemId === item.id &&
                            (productSuggestionsByItem[item.id]?.length || 0) >
                              0 && (
                              <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-sm max-h-60 overflow-auto">
                                {productSuggestionsByItem[item.id].map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-3"
                                    onMouseDown={(ev) => ev.preventDefault()}
                                    onClick={() => {
                                      // ✅ Auto-fill Brand + HSN + MRP
                                      updateItem(item.id, {
                                        description: p.name,
                                        product_id: p.id,
                                        brand: p.brandName ?? item.brand ?? "",
                                        hsn: p.hsn ?? item.hsn ?? "",
                                        unit_price: p.mrp ?? 0, // MRP into unit_price
                                      });

                                      setProductSuggestionsByItem((prev) => ({
                                        ...prev,
                                        [item.id]: [],
                                      }));
                                      setActiveSuggestForItemId(null);
                                    }}
                                  >
                                    <span className="truncate">{p.name}</span>
                                    <span className="text-xs text-slate-600">
                                      {p.mrp != null
                                        ? formatINR(Number(p.mrp))
                                        : ""}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}

                          {!isCustom &&
                            item.description.trim() &&
                            !item.product_id && (
                              <div className="mt-1 text-xs text-amber-600">
                                Select from suggestions
                              </div>
                            )}
                        </td>

                        {/* HSN (auto-filled; still editable) */}
                        <td className="px-2 py-2">
                          <Input
                            value={item.hsn || ""}
                            onChange={(e) =>
                              updateItem(item.id, { hsn: e.target.value })
                            }
                            placeholder="HSN"
                          />
                        </td>

                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            value={String(item.quantity ?? 0)}
                            onChange={(e) =>
                              updateItem(item.id, {
                                quantity: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>

                        {/* MRP only (no Rate column) */}
                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(item.unit_price ?? 0)}
                            onChange={(e) =>
                              updateItem(item.id, {
                                unit_price: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>

                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(item.discount ?? 0)}
                            onChange={(e) =>
                              updateItem(item.id, {
                                discount: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>

                        <td className="px-2 py-2 text-right font-medium">
                          {formatINR(lineAmount)}
                        </td>

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
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals (right) */}
            <div className="mt-4 flex flex-col items-end gap-2">
              <div className="w-full max-w-sm rounded-md border p-3 text-sm">
                <div className="grid grid-cols-2 gap-y-1">
                  <div className="text-muted-foreground">Subtotal</div>
                  <div className="text-right font-medium">
                    {formatINR(subtotal)}
                  </div>

                  <div className="text-muted-foreground">Discount</div>
                  <div className="text-right font-medium">
                    {formatINR(discountTotal)}
                  </div>

                  <div className="text-muted-foreground border-t mt-1 pt-2">
                    Taxable Amount
                  </div>
                  <div className="text-right font-medium border-t mt-1 pt-2">
                    {formatINR(taxableAmount)}
                  </div>

                  {taxType === "CGST_SGST" ? (
                    <>
                      <div className="text-muted-foreground">CGST</div>
                      <div className="text-right">{formatINR(cgstAmount)}</div>
                      <div className="text-muted-foreground">SGST</div>
                      <div className="text-right">{formatINR(sgstAmount)}</div>
                    </>
                  ) : null}

                  {taxType === "IGST" ? (
                    <>
                      <div className="text-muted-foreground">IGST</div>
                      <div className="text-right">{formatINR(igstAmount)}</div>
                    </>
                  ) : null}

                  <div className="col-span-2 border-t mt-2 pt-2 flex justify-between font-semibold">
                    <span>Invoice Amount</span>
                    <span>{formatINR(grandTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Tax controls */}
              <div className="w-full max-w-sm rounded-md border p-3 text-sm">
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
                      <div className="text-xs text-muted-foreground mb-1">
                        CGST %
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={String(cgstPercent)}
                        onChange={(e) =>
                          setCgstPercent(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">
                        SGST %
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={String(sgstPercent)}
                        onChange={(e) =>
                          setSgstPercent(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                  </div>
                )}

                {taxType === "IGST" && (
                  <div className="mt-2">
                    <div className="text-xs text-muted-foreground mb-1">
                      IGST %
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={String(igstPercent)}
                      onChange={(e) =>
                        setIgstPercent(Number(e.target.value) || 0)
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="border-t pt-4">
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Bottom actions */}
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => router.push(`/vendor/invoices/${invoiceId}`)}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Print helpers (hide action buttons) */}
      <style jsx global>{`
        @media print {
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
