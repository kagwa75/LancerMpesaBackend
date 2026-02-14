#!/bin/bash

echo "🧪 Testing M-Pesa Integration..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Health Check
echo "${YELLOW}1. Testing health check...${NC}"
curl -s http://localhost:4000/ | jq '.'
echo ""

# Test 2: STK Push
echo "${YELLOW}2. Initiating STK Push...${NC}"
RESPONSE=$(curl -s -X POST http://localhost:4000/mpesa/stk-push \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "254746221954",
    "amount": 10,
    "accountReference": "TEST_001",
    "transactionDesc": "Test Payment"
  }')

echo "$RESPONSE" | jq '.'
echo ""

# Extract CheckoutRequestID
CHECKOUT_ID=$(echo "$RESPONSE" | jq -r '.data.checkoutRequestID')

if [ "$CHECKOUT_ID" != "null" ]; then
  echo "${GREEN}✅ STK Push successful!${NC}"
  echo "${YELLOW}CheckoutRequestID: $CHECKOUT_ID${NC}"
  echo ""
  
  # Wait for user to complete payment
  echo "${YELLOW}Complete the payment on your phone (you have 60 seconds)...${NC}"
  echo "Press Enter after completing the payment to check status..."
  read
  
  # Test 3: Query Status
  echo "${YELLOW}3. Checking payment status...${NC}"
  for i in {1..5}; do
    echo "${YELLOW}Attempt $i/5...${NC}"
    curl -s -X POST http://localhost:4000/mpesa/query-stk \
      -H "Content-Type: application/json" \
      -d "{\"checkoutRequestID\": \"$CHECKOUT_ID\"}" | jq '.'
    
    echo ""
    sleep 5
  done
else
  echo "❌ STK Push failed!"
fi
