// Store services retrieved from the backend.
let waterServices = [];
let laundryServices = [];

function switchView(viewId, event) {
            document.querySelectorAll('.panel-section').forEach(sec => sec.classList.remove('active'));
            document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => btn.classList.remove('active'));

            document.getElementById(viewId).classList.add('active');
            if (event && event.currentTarget) {
                event.currentTarget.classList.add('active');
            }

            const titles = {
                'choose-service': ['HOME', 'Select your service, fill out order details, and track your requests.'],
                'order-tracker': ['Track Order Status', 'Monitor active water orders and laundry turnaround states.'],
                'account-settings': ['Account Settings', 'Manage your profile and account preferences.']
            };
            document.getElementById('header-title').innerText = titles[viewId][0];
            document.getElementById('header-desc').innerText = titles[viewId][1];
        }

        function selectServiceTab(type) {
            const promptBox = document.getElementById('no-service-prompt');
            if (promptBox) {
                promptBox.style.display = 'none';
            }

            document.getElementById('tab-water-btn').classList.remove('active');
            document.getElementById('tab-laundry-btn').classList.remove('active');

            document.getElementById('water-form-content').classList.remove('active');
            document.getElementById('laundry-form-content').classList.remove('active');

            if (type === 'water') {
                document.getElementById('tab-water-btn').classList.add('active');
                document.getElementById('water-form-content').classList.add('active');
            } else if (type === 'laundry') {
                document.getElementById('tab-laundry-btn').classList.add('active');
                document.getElementById('laundry-form-content').classList.add('active');
            }
        }

        

function toggleSchedule(service) {
    if (service === 'water') {
        const arrangement = document.getElementById('waterDeliveryToggle').value;
        const deliveryBox = document.getElementById('waterAddressBox');

        if (deliveryBox) {
            deliveryBox.style.display =
                arrangement === 'home_pickup_delivery' ? 'flex' : 'none';
        }

        return;
    }

    if (service === 'laundry') {
        const arrangement = document.getElementById('laundryDeliveryToggle').value;

        const scheduleBox = document.getElementById('laundryScheduleBox');
        const pickupBox = document.getElementById('laundryPickupAddressBox');
        const deliveryBox = document.getElementById('laundryAddressBox');

        // Keep the optional scheduling field visible.
        if (scheduleBox) {
            scheduleBox.style.display = 'flex';
        }

        // Show pickup address only when the customer requests home pickup.
        if (pickupBox) {
            pickupBox.style.display =
                arrangement === 'home_pickup_return_delivery' ||
                arrangement === 'home_pickup_station_pickup'
                    ? 'flex'
                    : 'none';
        }

        // Show delivery address when home delivery is selected.
        if (deliveryBox) {
            deliveryBox.style.display =
                arrangement === 'drop_off_home_delivery' ||
                arrangement === 'home_pickup_return_delivery'
                    ? 'flex'
                    : 'none';
        }
    }
}

        let signinRedirectUrl = "customer.html";

function openSigninModal(redirectUrl = "customer.html", autoRedirectMs = 0) {
    signinRedirectUrl = redirectUrl;

    const modal = document.getElementById("signin-modal-backdrop");
    const continueBtn = document.getElementById("signin-continue-btn");

    if (continueBtn) {
        continueBtn.href = signinRedirectUrl;
    }

    if (modal) {
        modal.hidden = false;
    }

    if (autoRedirectMs > 0) {
        setTimeout(() => {
            window.location.href = signinRedirectUrl;
        }, autoRedirectMs);
    }
}

function closeSigninModal() {
    const modal = document.getElementById("signin-modal-backdrop");
    if (modal) {
        modal.hidden = true;
    }
}

document.addEventListener("click", function (event) {
    const modal = document.getElementById("signin-modal-backdrop");
    if (modal && !modal.hidden && event.target === modal) {
        closeSigninModal();
    }
});

document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
        closeSigninModal();
    }
});

        function openLogoutModal(event) {
    if (event) {
        event.preventDefault();
    }


    const modal = document.getElementById('logout-modal-backdrop');
    if (modal) {
        modal.hidden = false;
    }
}

function closeLogoutModal() {
    const modal = document.getElementById('logout-modal-backdrop');
    if (modal) {
        modal.hidden = true;
    }
}

document.addEventListener('click', function (event) {
    const modal = document.getElementById('logout-modal-backdrop');
    if (modal && !modal.hidden && event.target === modal) {
        closeLogoutModal();
    }
});

document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        closeLogoutModal();
    }
});

// Load the authenticated customer's profile.

document.addEventListener("DOMContentLoaded", async function () {
    const accessToken = sessionStorage.getItem("acs_access_token");
    const savedUser = sessionStorage.getItem("acs_user");

    if (!accessToken || !savedUser) {
        window.location.href = "./index.html";
        return;
    }

    try {
        // Retrieve the latest customer profile from the backend.
        const response = await fetch("http://localhost:3000/api/users/me", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            if (response.status === 401) {
                sessionStorage.removeItem("acs_access_token");
                sessionStorage.removeItem("acs_refresh_token");
                sessionStorage.removeItem("acs_user");
                window.location.href = "./index.html";
                return;
            }

            throw new Error(result.message || "Unable to retrieve customer profile.");
        }

        const user = result.user;

        // Update the locally saved customer information.
        sessionStorage.setItem("acs_user", JSON.stringify(user));
        window.acsCustomer = user;

        // Update sidebar.
        document.getElementById("customer-sidebar-name").textContent =
            user.full_name || user.email;

        document.getElementById("customer-sidebar-role").textContent =
            user.role || "Account";

        // Update Account Settings.
        document.getElementById("customer-full-name").value =
            user.full_name || "";

        document.getElementById("customer-email").value =
            user.email || "";

        document.getElementById("customer-phone").value =
            user.phone || "";

        document.getElementById("customer-address").value =
            user.default_address || "";

        console.log("Customer profile retrieved from API:", user);

    } catch (error) {
        console.error("Profile loading failed:", error);
        alert(error.message || "Unable to load customer profile.");
    }
});

document.addEventListener("DOMContentLoaded", function () {
    const saveProfileButton = document.getElementById("save-customer-profile");

    if (!saveProfileButton) return;

    saveProfileButton.addEventListener("click", async function () {
        const accessToken = sessionStorage.getItem("acs_access_token");

        const fullName = document.getElementById("customer-full-name").value.trim();
        const phone = document.getElementById("customer-phone").value.trim();
        const address = document.getElementById("customer-address").value.trim();

        if (!fullName) {
            alert("Please enter your full name.");
            return;
        }

        saveProfileButton.disabled = true;
        saveProfileButton.innerHTML = "Saving...";

        try {
            const response = await fetch("http://localhost:3000/api/users/me", {
                method: "PUT",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    full_name: fullName,
                    phone: phone,
                    default_address: address
                })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || "Unable to update profile.");
            }

            const updatedUser = result.user;

            sessionStorage.setItem("acs_user", JSON.stringify(updatedUser));
            window.acsCustomer = updatedUser;

            document.getElementById("customer-sidebar-name").textContent =
                updatedUser.full_name || updatedUser.email;

            alert("Profile updated successfully!");

            console.log("Customer profile updated:", updatedUser);

        } catch (error) {
            console.error("Profile update failed:", error);
            alert(error.message || "Unable to save profile.");
        } finally {
            saveProfileButton.disabled = false;
            saveProfileButton.innerHTML =
                '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
        }
    });
});

// Load Water and Laundry services from the backend.
document.addEventListener("DOMContentLoaded", async function () {
    await loadServiceCatalogs();
});

async function loadServiceCatalogs() {
    try {
        const [waterResponse, laundryResponse] = await Promise.all([
            fetch("http://localhost:3000/api/services?service_type=Water"),
            fetch("http://localhost:3000/api/services?service_type=Laundry")
        ]);

        const waterResult = await waterResponse.json();
        const laundryResult = await laundryResponse.json();

        if (!waterResponse.ok || !waterResult.success) {
            throw new Error("Unable to load Water services.");
        }

        if (!laundryResponse.ok || !laundryResult.success) {
            throw new Error("Unable to load Laundry services.");
        }

        waterServices = waterResult.data;
        laundryServices = laundryResult.data;

        populateServiceDropdown(
            "waterType",
            waterServices,
            "Select a Water Service"
        );

        populateServiceDropdown(
            "laundryService",
            laundryServices,
            "Select a Laundry Service"
        );

        console.log("Water services loaded:", waterServices);
        console.log("Laundry services loaded:", laundryServices);

    } catch (error) {
        console.error("Service catalog loading failed:", error);
        alert(error.message);
    }
}

function populateServiceDropdown(elementId, services, placeholder) {
    const dropdown = document.getElementById(elementId);

    if (!dropdown) return;

    dropdown.innerHTML = `<option value="">${placeholder}</option>`;

    services.forEach(service => {
        const option = document.createElement("option");

        option.value = service.id;
        option.textContent =
            `${service.item_name} - ₱${Number(service.selling_price).toFixed(2)}`;

        dropdown.appendChild(option);
    });
}

function calculateLaundryTotal() {
    const serviceId = document.getElementById("laundryService").value;
    const weightKg = Number(document.getElementById("laundryLoads").value);
    const displayTotal = document.getElementById("laundryDisplayTotal");

    const selectedService = laundryServices.find(
        service => service.id === serviceId
    );

    if (!selectedService || weightKg <= 0 || !Number.isFinite(weightKg)) {
        displayTotal.textContent = "₱0.00";
        return;
    }

    const pricePerLoad = Number(selectedService.selling_price);
    const numberOfLoads = Math.ceil(weightKg / 7);
    const total = numberOfLoads * pricePerLoad;

    displayTotal.textContent = `₱${total.toFixed(2)}`;
}

function calculateWaterTotal() {
    const serviceId = document.getElementById("waterType").value;
    const quantity = Number(document.getElementById("waterQty").value);
    const displayTotal = document.getElementById("waterDisplayTotal");

    const selectedService = waterServices.find(
        service => service.id === serviceId
    );

    if (!selectedService || quantity <= 0 || !Number.isFinite(quantity)) {
        displayTotal.textContent = "₱0.00";
        return;
    }

    const unitPrice = Number(selectedService.selling_price);
    const total = quantity * unitPrice;

    displayTotal.textContent = `₱${total.toFixed(2)}`;
}


document.addEventListener("DOMContentLoaded", function () {
    const waterSubmitButton = document.getElementById("submit-water-order");

    if (waterSubmitButton) {
        waterSubmitButton.addEventListener("click", submitWaterOrder);
    }
});

async function submitWaterOrder() {
    const waterSubmitButton = document.getElementById("submit-water-order");
    const accessToken = sessionStorage.getItem("acs_access_token");

    const serviceId = document.getElementById("waterType").value;
    const arrangement = document.getElementById("waterDeliveryToggle").value;
    const quantity = Number(document.getElementById("waterQty").value);

    const pickupAddress = document.getElementById("waterPickupAddress").value.trim();
    const deliveryAddress = document.getElementById("waterDeliveryAddress").value.trim();

    const scheduledValue = document.getElementById("waterScheduledAt").value;
    const paymentMethod = document.getElementById("waterPaymentMethod").value;
    const paymentReference = document.getElementById("waterPaymentReference").value.trim();

    // Basic validation
    if (!accessToken) {
        alert("Your session has expired. Please sign in again.");
        window.location.href = "index.html";
        return;
    }

    if (!serviceId) {
        alert("Please select a Water service.");
        return;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
        alert("Please enter a valid quantity.");
        return;
    }

    if (!pickupAddress) {
        alert("Please enter your pickup address.");
        return;
    }

    if (arrangement === "home_pickup_delivery" && !deliveryAddress) {
        alert("Please enter your delivery address.");
        return;
    }

    if (paymentMethod === "GCash Online Payment" && !paymentReference) {
        alert("Please enter your GCash reference number.");
        return;
    }

    // Convert the optional schedule to ISO format.
    let scheduledAt = null;

    if (scheduledValue) {
        const selectedDate = new Date(scheduledValue);

        if (Number.isNaN(selectedDate.getTime()) || selectedDate <= new Date()) {
            alert("Please select a future date and time.");
            return;
        }

        scheduledAt = selectedDate.toISOString();
    }

    const orderData = {
        service_type: "Water",
        service_arrangement: arrangement,
        service_id: serviceId,
        quantity: quantity,
        pickup_address: pickupAddress,
        delivery_address: arrangement === "home_pickup_delivery" ? deliveryAddress : null,
        scheduled_at: scheduledAt,
        payment_method: paymentMethod
    };

    if (paymentMethod === "GCash Online Payment") {
        orderData.reference_number = paymentReference;
    }

    try {
        waterSubmitButton.disabled = true;
        waterSubmitButton.textContent = "Submitting...";

        const response = await fetch("http://localhost:3000/api/orders", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`
            },
            body: JSON.stringify(orderData)
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.message || "Unable to submit Water order.");
        }

        alert("Water order submitted successfully!");

        console.log("Water order response:", result);

    } catch (error) {
        console.error("Water order submission failed:", error);
        alert(error.message);
    } finally {
        waterSubmitButton.disabled = false;
        waterSubmitButton.innerHTML =
            '<i class="fa-solid fa-paper-plane"></i> Submit Water Order';
    }
}

function toggleBleachOption() {
    const bleachRequested = document.getElementById("laundryBleach").value;
    const bleachProductBox = document.getElementById("laundryBleachProductBox");
    const bleachProduct = document.getElementById("laundryBleachProduct");

    if (bleachRequested === "true") {
        bleachProductBox.style.display = "flex";
    } else {
        bleachProductBox.style.display = "none";
        bleachProduct.value = "";
    }
}