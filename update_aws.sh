pm2 delete server
pm2 save
cp dist/inventory.json inventory.json
rm -rf dist
rm public_build_florrclone.zip
wget https://sussybite.s3.amazonaws.com/public_build_florrclone.zip
unzip public_build_florrclone.zip
rm public_build_florrclone.zip
cd dist
npm install socket.io express
wget https://sussybite.s3.amazonaws.com/cert.key
wget https://sussybite.s3.amazonaws.com/cert.crt
rm inventory.json
cp ~/inventory.json inventory.json
rm ~/inventory.json
pm2 start server.js
pm2 save
sudo reboot