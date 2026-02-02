import { useLoaderData, useSubmit, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { useState, useCallback, useEffect } from "react";
import "../styles/index.css";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Fetch Products and Variants
  const productsQuery = `
    query {
      products(first: 250) {
        edges {
          node {
            id
            title
            featuredImage {
              url
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  price
                  sku
                }
              }
            }
          }
        }
      }
    }
  `;

  // Fetch Existing Discount Function to get ID
  const functionsQuery = `
    query {
      shopifyFunctions(first: 25) {
        nodes {
          id
          title
          apiType
        }
      }
    }
  `;

  // Fetch Existing Automatic Discount Config (Broad query to find what's missing)
  const discountsQuery = `
    query {
      discountNodes(first: 50) {
        nodes {
          id
          metafields(first: 10) {
            nodes {
              id
              namespace
              key
              value
            }
          }
          discount {
            __typename
            ... on DiscountAutomaticApp {
              title
              status
              appDiscountType {
                functionId
              }
            }
          }
        }
      }
    }
  `;

  const [productsResult, functionsResult, discountsResult] = await Promise.all([
    admin.graphql(productsQuery),
    admin.graphql(functionsQuery),
    admin.graphql(discountsQuery),
  ]);

  const productsJson = await productsResult.json();
  const functionsJson = await functionsResult.json();
  const discountsJson = await discountsResult.json();

  console.log("DEBUG: Functions Found:", JSON.stringify(functionsJson.data?.shopifyFunctions?.nodes));
  console.log("DEBUG: Discounts Found Rows:", discountsJson.data?.discountNodes?.nodes?.length);

  // Parse existing config
  let existingConfig = {};
  let mainDiscountId = null;
  let mainMetafieldId = null;

  const myFunctions = functionsJson.data?.shopifyFunctions?.nodes || [];
  const myFunction = myFunctions.find((f) =>
    f.title === "discount-function" ||
    f.apiType === "cart_lines_discounts" ||
    f.apiType?.includes("discount")
  );
  const functionId = myFunction?.id;

  if (functionId) {
    const uuid = functionId.split("/").pop();
    const allDiscounts = discountsJson.data?.discountNodes?.nodes || [];

    let ourDiscounts = allDiscounts.filter((node) => {
      const nodeFuncId = node.discount.appDiscountType?.functionId;
      return nodeFuncId === uuid || nodeFuncId === functionId || (nodeFuncId && uuid && nodeFuncId.includes(uuid));
    });

    if (ourDiscounts.length === 0) {
      ourDiscounts = allDiscounts.filter((node) => {
        const title = node.discount?.title || "";
        return title === "Automatic Variant Discounts" || title.startsWith("Discount:");
      });
    }

    if (ourDiscounts.length > 0) {
      // Prefer the consolidated node if it exists
      const mainNode = ourDiscounts.find(n => n.discount.title === "Automatic Variant Discounts") || ourDiscounts[0];
      mainDiscountId = mainNode.id;

      // Extract config from ALL existing nodes to ensure we don't lose data during migration
      ourDiscounts.forEach((node) => {
        const metafields = node.metafields?.nodes || [];
        metafields.forEach((m) => {
          if (m.key === "function-configuration") {
            if (node.id === mainDiscountId) mainMetafieldId = m.id;
            try {
              const parsed = JSON.parse(m.value);
              const vDiscounts = parsed.variantDiscounts || {};
              Object.assign(existingConfig, vDiscounts);
            } catch (e) {
              console.error("Failed to parse config", e);
            }
          }
        });
      });
    }
  }

  return {
    products: productsJson.data?.products?.edges || [],
    functionId,
    existingConfig,
    mainDiscountId,
    mainMetafieldId,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const variantDiscountsStr = formData.get("variantDiscounts");
  const functionId = formData.get("functionId");
  const mainDiscountId = formData.get("mainDiscountId");
  const mainMetafieldId = formData.get("mainMetafieldId");

  const variantDiscounts = JSON.parse(variantDiscountsStr);
  const errors = [];

  // Consolidate all non-zero discounts
  const activeDiscounts = {};
  Object.keys(variantDiscounts).forEach(vId => {
    const val = parseFloat(variantDiscounts[vId]);
    if (val > 0) activeDiscounts[vId] = val;
  });

  const metafieldValue = JSON.stringify({ variantDiscounts: activeDiscounts });
  const metafield = {
    namespace: "$app:smart-variant-discounts",
    key: "function-configuration",
    value: metafieldValue,
    type: "json",
  };
  if (mainMetafieldId && mainMetafieldId !== "null") {
    metafield.id = mainMetafieldId;
  }

  try {
    if (mainDiscountId && mainDiscountId !== "null") {
      // Update existing consolidated node
      const response = await admin.graphql(
        `#graphql
          mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
            discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
              userErrors { field message }
            }
          }`,
        {
          variables: {
            id: mainDiscountId,
            automaticAppDiscount: {
              discountClasses: ["PRODUCT"],
              metafields: [metafield],
            },
          },
        }
      );
      const json = await response.json();
      if (json.data?.discountAutomaticAppUpdate?.userErrors?.length > 0) {
        errors.push(...json.data.discountAutomaticAppUpdate.userErrors);
      }
    } else if (Object.keys(activeDiscounts).length > 0) {
      // Create new consolidated node
      const response = await admin.graphql(
        `#graphql
          mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
            discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
              userErrors { field message }
            }
          }`,
        {
          variables: {
            automaticAppDiscount: {
              title: "[Smart Discount] Automatic Subscription Discounts",
              functionId: functionId,
              startsAt: new Date().toISOString(),
              discountClasses: ["PRODUCT"],
              metafields: [metafield],
            },
          },
        }
      );
      const json = await response.json();
      if (json.data?.discountAutomaticAppCreate?.userErrors?.length > 0) {
        errors.push(...json.data.discountAutomaticAppCreate.userErrors);
      }
    }
  } catch (error) {
    errors.push({ message: error.message });
  }

  if (errors.length > 0) return { status: "error", errors };
  return { status: "success" };
};

export default function Discounts() {
  const { products, existingConfig, functionId, mainDiscountId, mainMetafieldId } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting" || navigation.state === "loading";

  const [discounts, setDiscounts] = useState(existingConfig || {});
  const [isHydrated, setIsHydrated] = useState(false);
  const [banner, setBanner] = useState(null);

  // Show banner when action succeeds or fails
  useEffect(() => {
    if (actionData?.status === "success") {
      setBanner({ type: "success" });
      const timer = setTimeout(() => setBanner(null), 5000);
      return () => clearTimeout(timer);
    }
    if (actionData?.status === "error") {
      setBanner({ type: "error" });
      const timer = setTimeout(() => setBanner(null), 10000); // Errors stay longer
      return () => clearTimeout(timer);
    }
  }, [actionData]);

  // Sync state when loader data changes (after refresh/action)
  useEffect(() => {
    setIsHydrated(true);
    if (existingConfig) {
      setDiscounts(existingConfig);
    }
  }, [existingConfig]);

  const handleDiscountChange = useCallback((variantId, value) => {
    setDiscounts((prev) => ({
      ...prev,
      [variantId]: value === "" ? "" : parseFloat(value) || 0,
    }));
  }, []);

  const handleSave = () => {
    const formData = new FormData();
    formData.append("variantDiscounts", JSON.stringify(discounts));
    formData.append("functionId", functionId);
    formData.append("mainDiscountId", mainDiscountId);
    formData.append("mainMetafieldId", mainMetafieldId);

    submit(formData, { method: "post" });
  };

  // Flatten variants to rows
  const rows = [];
  products.forEach((pEdge) => {
    const p = pEdge.node;
    p.variants.edges.forEach((vEdge) => {
      const v = vEdge.node;
      rows.push({
        id: v.id,
        productId: p.id,
        productTitle: p.title,
        variantTitle: v.title,
        sku: v.sku,
        price: v.price,
        imageUrl: p.featuredImage?.url,
        discount: discounts[v.id] !== undefined ? discounts[v.id] : "",
      });
    });
  });

  // CRITICAL DEBUG: Compare IDs
  useEffect(() => {
    if (rows.length > 0 && Object.keys(discounts).length > 0) {
      console.log("DEBUG UI: Sample Row ID:", rows[0].id);
      console.log("DEBUG UI: Sample Config ID:", Object.keys(discounts)[0]);
      console.log("DEBUG UI: Match found for sample?", !!discounts[rows[0].id]);
    }
  }, [rows, discounts]);

  if (!isHydrated) return null;

  return (
    <s-page heading="Automatic Discounts">
      {banner?.type === "success" && (
        <div className="banner-success">
          Discounts updated successfully!
        </div>
      )}
      {banner?.type === "error" && (
        <div className="banner-error">
          <div className="stack-block gap-small">
            Error saving discounts:
            {actionData?.errors?.map((e, i) => (
              <div key={i}>{e.message}</div>
            ))}
            {actionData?.message && <div>{actionData.message}</div>}
          </div>
        </div>
      )}
      <s-button slot="primary-action" onClick={handleSave} loading={isLoading}>
        Save Discounts
      </s-button>

      <s-section>
        <div className="discount-table-container">
          <div className="stack-block">
            {/* Table Header */}
            <div className="p-base border-bottom">
              <div className="flex-center gap-base">
                <div className="col-product table-header-text">Product</div>
                <div className="col-variant table-header-text">Variant</div>
                <div className="col-sku table-header-text">SKU</div>
                <div className="col-price table-header-text">Price</div>
                <div className="col-discount table-header-text">Discount (%)</div>
              </div>
            </div>

            {/* Table Rows */}
            {rows.map((row) => (
              <div key={row.id} className="p-base border-bottom">
                <div className="flex-center gap-base">
                  <div className="col-product">
                    <div className="flex-center gap-small">
                      {row.imageUrl && (
                        <img
                          src={row.imageUrl}
                          alt={row.productTitle}
                          className="product-variant-image"
                        />
                      )}
                      {row.productTitle}
                    </div>
                  </div>
                  <div className="col-variant">{row.variantTitle}</div>
                  <div className="col-sku">{row.sku}</div>
                  <div className="col-price">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parseFloat(row.price))}
                  </div>
                  <div className="col-discount">
                    <s-text-field
                      value={row.discount.toString()}
                      onInput={(e) => handleDiscountChange(row.id, e.target.value)}
                    ></s-text-field>
                  </div>
                </div>
              </div>
            ))}

            {rows.length === 0 && (
              <div className="p-base text-center">
                No products found.
              </div>
            )}
          </div>
        </div>
      </s-section>
    </s-page>
  );
}
