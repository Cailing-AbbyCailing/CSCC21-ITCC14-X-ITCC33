'use strict';

/**
 * Laundry catalog prices are expressed per machine load, not per kilogram.
 * A load can contain up to kgPerLoad kilograms; partial extra loads are rounded up.
 */
function calculateLaundryPricing(weightKg, pricePerLoad, kgPerLoad = 7) {
    const weight = Number(weightKg);
    const price = Number(pricePerLoad);
    const loadLimit = Number(kgPerLoad);

    if (!Number.isFinite(weight) || weight <= 0) {
        throw new TypeError('Laundry weight must be a finite number greater than 0.');
    }
    if (!Number.isFinite(price) || price < 0) {
        throw new TypeError('Laundry price per load must be a finite non-negative number.');
    }
    if (!Number.isFinite(loadLimit) || loadLimit <= 0) {
        throw new TypeError('Laundry kilograms per load must be a finite number greater than 0.');
    }

    const loadCount = Math.ceil(weight / loadLimit);
    const totalAmount = Number((loadCount * price).toFixed(2));

    return {
        weightKg: Number(weight.toFixed(2)),
        loadCount,
        pricePerLoad: Number(price.toFixed(2)),
        kgPerLoad: loadLimit,
        totalAmount
    };
}

module.exports = { calculateLaundryPricing };
