
const express = require('express');
const supabase = require('./supabase');

const app = express();
const PORT = 3001;

app.use(express.json());

// Test route
app.get('/', (req, res) => {
    res.send('Analytics API is running!');
});

// Get analytics overview
app.get('/api/analytics/overview', async (req, res) => {
    try {
        // Get orders
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('id, status');

        if (ordersError) throw ordersError;

        // Get payments
        const { data: payments, error: paymentsError } = await supabase
            .from('payments')
            .select('amount, payment_status, created_at');

        if (paymentsError) throw paymentsError;

        // Get customer profiles
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, role');

        if (profilesError) throw profilesError;

        // Calculate current month's verified revenue
        const now = new Date();

        const monthlyRevenue = payments
            .filter(payment => {
                const paymentDate = new Date(payment.created_at);

                return (
                    payment.payment_status === 'verified' &&
                    paymentDate.getMonth() === now.getMonth() &&
                    paymentDate.getFullYear() === now.getFullYear()
                );
            })
            .reduce((total, payment) => {
                return total + Number(payment.amount);
            }, 0);

        // Count active orders
        const activeOrders = orders.filter(order =>
            ['Pending', 'In Progress', 'Out for Delivery']
                .includes(order.status)
        ).length;

        // Count completed orders
        const completedOrders = orders.filter(order =>
            order.status === 'Completed'
        ).length;

        // Count customers
        const totalCustomers = profiles.filter(profile =>
            profile.role === 'customer'
        ).length;

        res.json({
            success: true,
            data: {
                monthly_revenue: Number(monthlyRevenue.toFixed(2)),
                active_orders: activeOrders,
                total_customers: totalCustomers,
                completed_orders: completedOrders
            }
        });

    } catch (error) {
        console.error('Analytics error:', error.message);

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve analytics.'
        });
    }
});


// Get monthly revenue analytics
app.get('/api/analytics/revenue', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('payments')
            .select('amount, payment_status, created_at')
            .eq('payment_status', 'verified')
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Group payments by month
        const monthlyRevenue = {};

        data.forEach(payment => {
            const date = new Date(payment.created_at);

            const month = date.toLocaleString('en-US', {
                month: 'long',
                year: 'numeric',
                timeZone: 'Asia/Manila'
            });

            if (!monthlyRevenue[month]) {
                monthlyRevenue[month] = 0;
            }

            monthlyRevenue[month] += Number(payment.amount);
        });

        const revenueData = Object.entries(monthlyRevenue).map(
            ([month, total]) => ({
                month,
                revenue: Number(total.toFixed(2))
            })
        );

        res.json({
            success: true,
            count: revenueData.length,
            data: revenueData
        });

    } catch (error) {
        console.error('Revenue analytics error:', error.message);

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve revenue analytics.'
        });
    }
});


// Get service breakdown analytics
app.get('/api/analytics/services', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('service_type');

        if (error) throw error;

        // Count orders per service type
        const serviceCounts = {};

        data.forEach(order => {
            const service = order.service_type;

            if (!serviceCounts[service]) {
                serviceCounts[service] = 0;
            }

            serviceCounts[service]++;
        });

        const serviceData = Object.entries(serviceCounts).map(
            ([service, total]) => ({
                service,
                total_orders: total
            })
        );

        res.json({
            success: true,
            count: serviceData.length,
            data: serviceData
        });

    } catch (error) {
        console.error('Service analytics error:', error.message);

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve service analytics.'
        });
    }
});


 // Get audit logs
app.get('/api/audit-logs', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('audit_logs')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            count: data.length,
            data: data
        });

    } catch (error) {
        console.error('Audit logs error:', error.message);

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve audit logs.'
        });
    }
});




// Start server
app.listen(PORT, () => {
    console.log(`Analytics API running at http://localhost:${PORT}`);
});
