        function switchView(viewId, event) {
            document.querySelectorAll('.panel-section').forEach(sec => sec.classList.remove('active'));
            document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => btn.classList.remove('active'));

            document.getElementById(viewId).classList.add('active');
            event.currentTarget.classList.add('active');

            const titles = {
                'choose-service': ['Main Menu (Home)', 'Select your service, fill out order details, and track your requests.'],
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
            const toggleVal = document.getElementById(service + 'DeliveryToggle').value;
            const scheduleBox = document.getElementById(service + 'ScheduleBox');
            const addressBox = document.getElementById(service + 'AddressBox');
            
            const showFields = (toggleVal === 'yes') ? 'flex' : 'none';
            if (scheduleBox) scheduleBox.style.display = showFields;
            if (addressBox) addressBox.style.display = showFields;
        }
