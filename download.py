import os
import sys
import ipfsapi

uri = sys.argv[1]
assetFolder = sys.argv[2]
filename = sys.argv[3]

api = ipfsapi.Client(host='https://ipfs.infura.io', port=5001)

os.chdir(assetFolder)

api.get(uri)
if os.path.exists(uri):
    os.rename(uri, filename)
