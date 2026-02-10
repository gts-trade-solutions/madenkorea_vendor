// app/vendor/(protected)/invoices/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { QuickAddAddressDialog } from "@/components/addresses/QuickAddAddressDialog";

const SUPPORT_EMAIL_FALLBACK = "info@madenkorea.com";

type InvoiceCompany = {
  id: string;
  key: string;
  display_name: string;
  address: string | null;
  gst_number: string | null;
  email: string | null;
};

type TaxType = "CGST_SGST" | "IGST" | "NONE";

type ProductSuggestion = {
  id: string;
  name: string;
  brand_name: string | null;
  mrp: number | null;
};


type InvoiceItem = {
  id: string;
  product_id?: string | null;
  brand: string;
  description: string;
  hsn: string;
  mrp: number; // ✅ ONLY price column used for calculations
  quantity: number;
  discount: number;
};

type InvoiceAddress = {
  id: string;
  vendor_id: string;
  label: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  created_at?: string;
};

const DEFAULT_NOTES = `Reseller Disclaimer
We are resellers and are not responsible for product usage or handling guidance. For detailed information on how to use the product safely and effectively, please contact the product manufacturer directly.

Return Policy
• Returns are accepted within 3 days from the date of delivery.
• Returns are only accepted for products with damaged packaging or expired items.
• Used products or items with broken or tampered seals are not eligible for return.`;

// ✅ INR format with Indian commas
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtINR = (v: any) =>
  inr.format(Number.isFinite(Number(v)) ? Number(v) : 0);

function createEmptyItem(): InvoiceItem {
  return {
    id: crypto.randomUUID(),
    product_id: null,
    brand: "",
    description: "",
    hsn: "",
    mrp: 0,
    quantity: 1,
    discount: 0,
  };
}

export default function NewInvoicePage() {
  const router = useRouter();

  const [taxType, setTaxType] = useState<TaxType>("CGST_SGST");
  const [cgstPercent, setCgstPercent] = useState<number>(9);
  const [sgstPercent, setSgstPercent] = useState<number>(9);
  const [igstPercent, setIgstPercent] = useState<number>(18);

  const [companies, setCompanies] = useState<InvoiceCompany[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState<boolean>(false);

  // ✅ Mode: Custom vs Web Generated
  const [isCustom, setIsCustom] = useState<boolean>(true);

  // ✅ Saved addresses + selection
  const [addresses, setAddresses] = useState<InvoiceAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");

  // ✅ Suggestions per-row
  const [productSuggestionsByItem, setProductSuggestionsByItem] = useState<
    Record<string, ProductSuggestion[]>
  >({});
  const [activeSuggestForItemId, setActiveSuggestForItemId] = useState<
    string | null
  >(null);

  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // --- Invoice form state ---
  const [companyId, setCompanyId] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  const [customerName, setCustomerName] = useState<string>("");
  const [billingAddress, setBillingAddress] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [gstNumber, setGstNumber] = useState<string>("");
  const [panNumber, setPanNumber] = useState<string>("");

  const [notes, setNotes] = useState<string>(DEFAULT_NOTES);
  const [items, setItems] = useState<InvoiceItem[]>([createEmptyItem()]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === companyId) ?? null,
    [companies, companyId],
  );

  // --- Load companies ---
  useEffect(() => {
    const loadCompanies = async () => {
      setLoadingCompanies(true);

      const { data, error } = await supabase
        .from("invoice_companies")
        .select("id, key, display_name, address, gst_number, email")
        .order("display_name", { ascending: true });

      if (error) {
        console.error("Error loading invoice_companies", error);
      } else if (data) {
        setCompanies(data as InvoiceCompany[]);
        if (data.length > 0) setCompanyId(data[0].id);
      }

      setLoadingCompanies(false);
    };

    loadCompanies();

    const today = new Date().toISOString().slice(0, 10);
    setInvoiceDate(today);
  }, []);

  // --- Load invoice addresses (vendor-scoped) ---
  useEffect(() => {
    const loadAddresses = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const vendorId = user.id;

      const { data, error } = await supabase
        .from("invoice_addresses")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error loading invoice_addresses", error);
        setAddresses([]);
      } else {
        setAddresses((data || []) as InvoiceAddress[]);
      }
    };

    loadAddresses();
  }, []);

  const sellerSupportEmail = selectedCompany?.email || SUPPORT_EMAIL_FALLBACK;

  // --- Item operations ---
  const updateItem = (id: string, patch: Partial<InvoiceItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  };

  const addItem = () => setItems((prev) => [...prev, createEmptyItem()]);

  const removeItem = (id: string) => {
    setItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((it) => it.id !== id),
    );
  };

  // --- Address selection -> prefill existing fields ---
  const applyAddressToCustomerFields = (addr: InvoiceAddress) => {
    setCustomerName(addr.name || "");
    setPhone(addr.phone || "");
    setEmail(addr.email || "");
    setGstNumber(addr.gstin || "");

    const fullAddress = [
      addr.address_line1,
      addr.address_line2,
      `${addr.city}, ${addr.state} - ${addr.pincode}`,
      addr.country || "India",
    ]
      .filter(Boolean)
      .join("\n");

    setBillingAddress(fullAddress);
  };

  // --- Totals calculation (MRP only) ---
  const { subtotal, discountTotal, taxableAmount } = useMemo(() => {
    let sub = 0;
    let disc = 0;

    for (const item of items) {
      const lineBase = item.quantity * item.mrp;
      sub += lineBase;
      disc += item.discount;
    }

    const taxable = sub - disc;

    return {
      subtotal: Number(sub.toFixed(2)),
      discountTotal: Number(disc.toFixed(2)),
      taxableAmount: Number(taxable.toFixed(2)),
    };
  }, [items]);

  // --- Tax calculation ---
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

  // --- Fetch suggestions per-row (web-generated mode only) ---
  const fetchProductSuggestions = async (itemId: string, query: string) => {
    if (isCustom) return;

    const q = query.trim();
    if (q.length < 2) {
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

const { data, error } = await supabase
  .from("products")
  .select(
    `
      id,
      name,
      brand_id,
      compare_at_price,
      brands:brands(name)
    `,
  )
  .ilike("name", `%${q}%`)
  .limit(10);


    if (error) {
      setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: [] }));
      return;
    }

const mapped: ProductSuggestion[] = (data || []).map((p: any) => ({
  id: p.id,
  name: p.name,
  brand_name: p.brands?.name ?? null,
  mrp: p.compare_at_price == null ? null : Number(p.compare_at_price),
}));


    setProductSuggestionsByItem((prev) => ({ ...prev, [itemId]: mapped }));
  };

  // --- Submit (invoice_number removed; DB should auto-generate) ---
  const handleSave = async () => {
    setError(null);
    setSuccessMessage(null);

    if (!companyId) return setError("Please select the invoice company.");
    if (!customerName.trim()) return setError("Please enter customer name.");
    if (!billingAddress.trim())
      return setError("Please enter billing address.");
    if (!phone.trim()) return setError("Please enter customer mobile number.");
    if (items.every((it) => !it.description.trim()))
      return setError("Please enter at least one line item description.");

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
      const { data: invoiceData, error: invoiceError } = await supabase
        .from("invoices")
        .insert([
          {
            company_id: companyId,
            // ✅ invoice_number not passed (auto generated in DB)
            invoice_date: invoiceDate || null,
            due_date: dueDate || null,

            customer_name: customerName,
            billing_address: billingAddress || null,
            phone: phone || null,
            email: email || null,
            contact_person: null,
            gst_number: gstNumber || null,
            pan_number: panNumber || null,

            subtotal,
            discount_total: discountTotal,

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

            notes: notes || null,

            is_custom: isCustom,
            bill_to_address_id: selectedAddressId || null,
          },
        ])
        .select("*")
        .single();

      if (invoiceError || !invoiceData) {
        console.error(invoiceError);
        throw new Error(invoiceError?.message || "Failed to create invoice");
      }

      const invoiceId = invoiceData.id as string;

      const itemsToInsert = items
        .filter((it) => it.description.trim())
        .map((it, index) => {
          const lineSubtotal = it.quantity * it.mrp - it.discount;

          return {
            invoice_id: invoiceId,
            product_id: it.product_id ?? null,
            brand: it.brand || null,
            description: it.description,
            hsn: it.hsn || null,
            quantity: it.quantity,
            unit_price: it.mrp, // ✅ keep DB column same, store MRP into unit_price
            discount: it.discount,
            line_subtotal: Number(lineSubtotal.toFixed(2)),
            line_total: Number(lineSubtotal.toFixed(2)),
            position: index,
          };
        });

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from("invoice_items")
          .insert(itemsToInsert);

        if (itemsError) {
          console.error(itemsError);
          throw new Error(
            itemsError.message || "Failed to create invoice items",
          );
        }
      }

      setSuccessMessage("Invoice saved successfully.");
      router.push(`/vendor/invoices/${invoiceId}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-6">
      <Button variant="outline" onClick={() => router.push("/vendor/invoices")}>
        ← Back to Invoices
      </Button>

      {/* Mode + Address */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <input
                id="is_custom"
                type="checkbox"
                checked={isCustom}
                onChange={(e) => {
                  const next = e.target.checked;
                  setIsCustom(next);

                  setItems((prev) =>
                    prev.map((it) => ({ ...it, product_id: null })),
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
                : "Type product name → select suggestion → Brand & HSN will auto-fill. You can edit MRP/Discount."}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Bill To Address (prefill)</Label>

              <div className="flex items-center gap-2">
                <QuickAddAddressDialog
                  triggerText="Quick Add"
                  onCreated={(created) => {
                    setAddresses((prev) => [created as any, ...prev]);
                    setSelectedAddressId(created.id);
                    applyAddressToCustomerFields(created as any);
                  }}
                />

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/vendor/addresses")}
                >
                  Manage
                </Button>
              </div>
            </div>

            <select
              value={selectedAddressId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedAddressId(id);

                const addr = addresses.find((a) => a.id === id);
                if (!addr) return;
                applyAddressToCustomerFields(addr);
              }}
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="">Select saved address</option>
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} — {a.city}
                </option>
              ))}
            </select>

            <p className="text-xs text-muted-foreground">
              Select an address to auto-fill Customer Details and Billing
              Address.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Main form */}
      <Card>
        <CardHeader>
          <CardTitle>Create Invoice</CardTitle>
          <CardDescription>
            Invoice number will be auto-generated when you save.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="rounded-md border border-green-500 bg-green-50 px-3 py-2 text-sm text-green-700">
              {successMessage}
            </div>
          )}

          {/* Company + basic invoice info */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Invoice Company</Label>
              <Select
                disabled={loadingCompanies}
                value={companyId || undefined}
                onValueChange={setCompanyId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs text-slate-700">
                <div className="font-medium">
                  Seller: {selectedCompany?.display_name || "-"}
                </div>
                <div>
                  Support Email:{" "}
                  {selectedCompany?.email || SUPPORT_EMAIL_FALLBACK}
                </div>
                <div>GSTIN: {selectedCompany?.gst_number || "-"}</div>
                <div className="whitespace-pre-line">
                  Address: {selectedCompany?.address || "-"}
                </div>
              </div>
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

          {/* Customer info */}
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

          {/* Line items */}
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
                    <th className="px-2 py-2 text-left">Brand</th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-left w-[120px]">HSN</th>
                    <th className="px-2 py-2 text-right w-[90px]">Qty</th>
                    <th className="px-2 py-2 text-right w-[120px]">MRP</th>
                    <th className="px-2 py-2 text-right w-[120px]">Discount</th>
                    <th className="px-2 py-2 text-right w-[140px]">Amount</th>
                    <th className="px-2 py-2 text-center w-[90px] print:hidden">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {items.map((item, idx) => {
                    const lineAmount = item.quantity * item.mrp - item.discount;

                    const brandLocked = !isCustom && !!item.product_id;
                    const hsnLocked = !isCustom && !!item.product_id;

                    return (
                      <tr key={item.id} className="border-t align-top">
                        <td className="px-2 py-2">{idx + 1}</td>

                        <td className="px-2 py-2">
                          <Input
                            value={item.brand}
                            onChange={(e) =>
                              updateItem(item.id, { brand: e.target.value })
                            }
                            placeholder="Brand"
                            disabled={brandLocked}
                          />
                        </td>

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
                                brand: "", // ✅ clear until user selects
                                hsn: "", // ✅ clear until user selects
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
                                {productSuggestionsByItem[item.id].map(
                                  (p: any) => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-3"
                                      onMouseDown={(ev) => ev.preventDefault()}
                                      onClick={() => {
                                        // ✅ Auto-fill Brand + HSN + MRP on selection
                                        updateItem(item.id, {
                                          description: p.name,
                                          product_id: p.id,
                                          brand: p.brand_name ?? "",
                                          hsn: p.hsn ?? "",
                                          mrp: p.mrp ?? 0,
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
                                        {p.mrp != null ? fmtINR(p.mrp) : ""}
                                      </span>
                                    </button>
                                  ),
                                )}
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

                        <td className="px-2 py-2">
                          <Input
                            value={item.hsn}
                            onChange={(e) =>
                              updateItem(item.id, { hsn: e.target.value })
                            }
                            placeholder="HSN"
                            disabled={hsnLocked}
                          />
                        </td>

                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            value={item.quantity.toString()}
                            onChange={(e) =>
                              updateItem(item.id, {
                                quantity: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>

                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.mrp.toString()}
                            onChange={(e) =>
                              updateItem(item.id, {
                                mrp: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>

                        <td className="px-2 py-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.discount.toString()}
                            onChange={(e) =>
                              updateItem(item.id, {
                                discount: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>

                        <td className="px-2 py-2 text-right font-medium">
                          {fmtINR(lineAmount)}
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

            {/* Totals */}
            <div className="mt-4 flex flex-col items-end space-y-1 text-sm">
              <div className="flex w-full max-w-sm justify-between">
                <span>Subtotal</span>
                <span>{fmtINR(subtotal)}</span>
              </div>

              <div className="flex w-full max-w-sm justify-between">
                <span>Discount</span>
                <span>{fmtINR(discountTotal)}</span>
              </div>

              <div className="flex w-full max-w-sm justify-between">
                <span className="text-muted-foreground">Taxable Amount</span>
                <span className="font-medium">{fmtINR(taxableAmount)}</span>
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
                    <div className="text-xs text-muted-foreground mb-1">
                      CGST %
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={cgstPercent.toString()}
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
                      value={sgstPercent.toString()}
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
                    value={igstPercent.toString()}
                    onChange={(e) =>
                      setIgstPercent(Number(e.target.value) || 0)
                    }
                  />
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="border-t pt-4">
            <div className="space-y-1">
              <Label>Notes / Internal Reference</Label>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => window.print()}
            >
              Print (Current View)
            </Button>

            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Invoice"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
