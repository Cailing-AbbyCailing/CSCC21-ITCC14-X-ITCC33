
const express = require('express');
const supabase = require('./supabase');

const app = express();
const PORT = 3000;

app.use(express.json());

// Test route
app.get('/', (req, res) => {
    res.send('Services API is running!');
});

// Get services
app.get('/api/services', async (req, res) => {
    try {
        let query = supabase
            .from('inventory')
            .select('*');

        const { service_type, available } = req.query;

        if (service_type) {
            query = query.eq('service_type', service_type);
        }

        if (available === 'true') {
            query = query.eq('availability', true);
        }

        const { data, error } = await query;

        if (error) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }

        res.json({
            success: true,
            count: data.length,
            data
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve services.'
        });
    }
});


// Add a new service
app.post('/api/services', async (req, res) => {
    try {
        const {
            item_name,
            service_type,
            category,
            description,
            unit,
            stock_quantity = 0,
            selling_price,
            availability = true
        } = req.body;

        // Validate required fields
        if (
            !item_name?.trim() ||
            !unit?.trim() ||
            selling_price === undefined ||
            selling_price === null
        ) {
            return res.status(400).json({
                success: false,
                message: 'Item name, unit, and selling price are required.'
            });
        }

        // Validate service type
        if (!['Water', 'Laundry', 'Printing'].includes(service_type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid service type.'
            });
        }

        // Validate price and stock
        if (
            !Number.isFinite(Number(selling_price)) ||
            Number(selling_price) < 0 ||
            !Number.isInteger(stock_quantity) ||
            stock_quantity < 0
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid selling price or stock quantity.'
            });
        }

        if (typeof availability !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'Availability must be true or false.'
            });
        }

        // Insert service into Supabase
        const { data, error } = await supabase
            .from('inventory')
            .insert([{
                item_name: item_name.trim(),
                service_type,
                category,
                description,
                unit: unit.trim(),
                stock_quantity,
                selling_price: Number(selling_price),
                availability
            }])
            .select()
            .single();

        if (error) {
            console.error('Supabase error:', error.message);

            return res.status(500).json({
                success: false,
                message: error.message
            });
        }

        res.status(201).json({
            success: true,
            message: 'Service added successfully!',
            data
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to add service.'
        });
    }
});


// Update an existing service
app.put('/api/services/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const allowedFields = [
            'item_name',
            'service_type',
            'category',
            'description',
            'unit',
            'stock_quantity',
            'selling_price',
            'availability'
        ];

        const updates = {};

        // Only accept recognized fields
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields provided for update.'
            });
        }

        // Validate service type
        if (
            updates.service_type !== undefined &&
            !['Water', 'Laundry', 'Printing'].includes(updates.service_type)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid service type.'
            });
        }

        // Validate text fields
        for (const field of ['item_name', 'unit']) {
            if (
                updates[field] !== undefined &&
                (typeof updates[field] !== 'string' || !updates[field].trim())
            ) {
                return res.status(400).json({
                    success: false,
                    message: `${field} must be a non-empty string.`
                });
            }
        }

        if (updates.item_name) {
            updates.item_name = updates.item_name.trim();
        }

        if (updates.unit) {
            updates.unit = updates.unit.trim();
        }

        // Validate price
        if (
            updates.selling_price !== undefined &&
            (
                !Number.isFinite(Number(updates.selling_price)) ||
                Number(updates.selling_price) < 0
            )
        ) {
            return res.status(400).json({
                success: false,
                message: 'Selling price must be a valid non-negative number.'
            });
        }

        if (updates.selling_price !== undefined) {
            updates.selling_price = Number(updates.selling_price);
        }

        // Validate stock quantity
        if (
            updates.stock_quantity !== undefined &&
            (
                !Number.isInteger(updates.stock_quantity) ||
                updates.stock_quantity < 0
            )
        ) {
            return res.status(400).json({
                success: false,
                message: 'Stock quantity must be a non-negative integer.'
            });
        }

        // Validate availability
        if (
            updates.availability !== undefined &&
            typeof updates.availability !== 'boolean'
        ) {
            return res.status(400).json({
                success: false,
                message: 'Availability must be true or false.'
            });
        }

        // Update service in Supabase
        const { data, error } = await supabase
            .from('inventory')
            .update(updates)
            .eq('id', id)
            .select()
            .maybeSingle();

        if (error) {
            console.error('Supabase error:', error.message);

            return res.status(500).json({
                success: false,
                message: error.message
            });
        }

        if (!data) {
            return res.status(404).json({
                success: false,
                message: 'Service not found.'
            });
        }

        res.json({
            success: true,
            message: 'Service updated successfully!',
            data
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update service.'
        });
    }
});



app.listen(PORT, () => {
    console.log(`Services API running at http://localhost:${PORT}`);
});
