#!/bin/bash
# Deployment script for word database fix

echo "🚀 Deploying Word Database Fix to VM"
echo "======================================"
echo ""

# Check if required variables are set
if [ -z "$VM_HOST" ]; then
    echo "⚠️  VM_HOST not set. Please provide your VM hostname or IP:"
    read -p "VM Host: " VM_HOST
fi

if [ -z "$VM_USER" ]; then
    echo "⚠️  VM_USER not set. Please provide your VM username:"
    read -p "VM User: " VM_USER
fi

if [ -z "$VM_PATH" ]; then
    echo "⚠️  VM_PATH not set. Please provide the path to your API deployment on the VM:"
    read -p "VM Path (e.g., /home/user/api-deploy): " VM_PATH
fi

echo ""
echo "📋 Deployment Configuration:"
echo "   VM Host: $VM_HOST"
echo "   VM User: $VM_USER"
echo "   VM Path: $VM_PATH"
echo ""

read -p "Continue with deployment? (y/n): " CONTINUE
if [ "$CONTINUE" != "y" ]; then
    echo "Deployment cancelled."
    exit 0
fi

echo ""
echo "📦 Step 1: Copying updated emotion-engine.js..."
scp api/emotion-engine.js "$VM_USER@$VM_HOST:$VM_PATH/api/emotion-engine.js"
if [ $? -eq 0 ]; then
    echo "   ✅ File copied successfully"
else
    echo "   ❌ File copy failed"
    exit 1
fi

echo ""
echo "🔍 Step 2: Checking file permissions..."
ssh "$VM_USER@$VM_HOST" "ls -la $VM_PATH/words/ | head -5"

echo ""
echo "🔑 Step 3: Verifying DeepSeek API key..."
ssh "$VM_USER@$VM_HOST" "if [ -z \"\$DEEPSEEK_API_KEY\" ]; then echo '❌ DeepSeek API key NOT set'; else echo '✅ DeepSeek API key is set'; fi"

echo ""
echo "🔄 Step 4: Restarting server..."
echo "   Please restart your Node.js server manually or select an option:"
echo "   1) Restart with PM2"
echo "   2) Restart with systemctl"
echo "   3) Skip restart (I'll do it manually)"
read -p "Select option (1-3): " RESTART_OPTION

case $RESTART_OPTION in
    1)
        echo "   Restarting with PM2..."
        ssh "$VM_USER@$VM_HOST" "pm2 restart all"
        if [ $? -eq 0 ]; then
            echo "   ✅ PM2 restart successful"
        else
            echo "   ⚠️  PM2 restart failed or PM2 not available"
        fi
        ;;
    2)
        echo "   Please provide the systemctl service name:"
        read -p "Service name: " SERVICE_NAME
        ssh "$VM_USER@$VM_HOST" "sudo systemctl restart $SERVICE_NAME"
        if [ $? -eq 0 ]; then
            echo "   ✅ Service restart successful"
        else
            echo "   ⚠️  Service restart failed"
        fi
        ;;
    3)
        echo "   ⏭️  Skipping restart. Remember to restart your server manually!"
        ;;
    *)
        echo "   ⚠️  Invalid option. Please restart your server manually."
        ;;
esac

echo ""
echo "✅ Deployment Complete!"
echo ""
echo "📊 Next Steps:"
echo "   1. Monitor your logs for '✅ Saved word' messages"
echo "   2. Test with: curl -X POST http://$VM_HOST:8080/v1/analyze-text \\"
echo "                 -H 'Authorization: Bearer YOUR_API_KEY' \\"
echo "                 -H 'Content-Type: application/json' \\"
echo "                 -d '{\"text\": \"I feel wonderfabulastic\"}'"
echo "   3. Verify word was saved: ssh $VM_USER@$VM_HOST \"grep -i wonderfabulastic $VM_PATH/words/w.json\""
echo ""
echo "📚 For detailed information, see WORD_DATABASE_FIX.md"

