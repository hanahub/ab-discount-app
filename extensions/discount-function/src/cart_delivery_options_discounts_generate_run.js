import {
  DeliveryDiscountSelectionStrategy,
  DiscountClass,
} from "../generated/api";

export function cartDeliveryOptionsDiscountsGenerateRun(input) {
  const firstDeliveryGroup = input.cart.deliveryGroups[0];
  if (!firstDeliveryGroup) {
    throw new Error("No delivery groups found");
  }

  const { deliveryPercentage } = parseMetafield(input.discount.metafield);
  const hasShippingDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Shipping,
  );
  if (!hasShippingDiscountClass) {
    return { operations: [] };
  }

  const operations = [];
  if (hasShippingDiscountClass && deliveryPercentage > 0) {
    operations.push({
      deliveryDiscountsAdd: {
        candidates: [
          {
            message: `${deliveryPercentage}% OFF DELIVERY`,
            targets: [
              {
                deliveryGroup: {
                  id: firstDeliveryGroup.id,
                },
              },
            ],
            value: {
              percentage: {
                value: deliveryPercentage,
              },
            },
          },
        ],
        selectionStrategy: DeliveryDiscountSelectionStrategy.All,
      },
    });
  }
  return { operations };
}

function parseMetafield(metafield) {
  try {
    const value = JSON.parse(metafield.value);
    return { deliveryPercentage: value.deliveryPercentage || 0 };
  } catch (error) {
    console.error("Error parsing metafield", error);
    return { deliveryPercentage: 0 };
  }
}