import os
import sys
import ipfsapi

uri = sys.argv[1]
filename = sys.argv[2]

api = ipfsapi.Client(host='https://ipfs.infura.io', port=5001)

assetFolder = "out/full/"
os.chdir(assetFolder)

api.get(uri)
if os.path.exists(uri):
    os.rename(uri, filename)
