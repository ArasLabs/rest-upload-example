/*** helper functions for sending rest calls *********************************/

/**
 * A helper function to send an HTTP call to the specified url.
 *
 * @param {*} type - HTTP call type. (GET or POST for this sample project)
 * @param {*} url - url to use for the HTTP call
 * @param {*} headers - an array of objects representing headers. Ex: [{name: "Content-Type", value: "application/json"}, {name: "AUTHUSER", value: "admin"}]
 * @param {*} body - body content of the HTTP call
 * @param {*} attempts - number of times we should attempt this call. Default value is 0.
 */
function httpReq(type, url, headers, body, attempts = 0) {
    return new Promise(function (resolve, reject) {
        // start building the request
        var httpRequest = new XMLHttpRequest();
        httpRequest.open(type, url, true);

        // add any headers passed to function
        headers = headers || [];
        for (var i = 0; i < headers.length; i++) {
            var header = headers[i];
            httpRequest.setRequestHeader(header.name, header.value);
        }
        
        // send the request
        httpRequest.send(body);

        // resolve or reject the promise when the response comes back
        httpRequest.onreadystatechange = function () {
            if (httpRequest.readyState == 4 && httpRequest.status == 200) {
	    	// resolve the promise and return the request object
                resolve(httpRequest);

            } else if (httpRequest.readyState == 4 && attempts !== 0) {
                // we have more attempts left, retry
                return httpReq(type, url, headers, body, attempts - 1);

            } else if (httpRequest.readyState == 4 && httpRequest.status == 400) {
	    	// reject the promise and return an error
                var err = new Error(httpRequest.statusText);
                reject(err);
            }
        };
    });
}


/**
 * 
 */
function getCredentials() {
    let urlField = document.getElementById("inn-url");
    let dbField = document.getElementById("inn-db");
    let userField = document.getElementById("inn-user");
    let pwdField = document.getElementById("inn-pwd");

    let creds = {};
    creds.url = urlField.value;
    creds.db = dbField.value;
    creds.user = userField.value;
    creds.pwd = md5(pwdField.value);

    return creds;
}


/**
 * 
 */
function getFile() {
    var myfile = null;
    var file = document.getElementById("file-field").files[0];
    var reader = new FileReader();

    reader.onload = function () {
        myfile = "url(" + reader.result + ")";
    };

    if (file) {
        myfile = reader.readAsDataURL(file);
    }

    return file;
}


/**
 * 
 * @param {*} chunkSize 
 * @param {*} file 
 * @param {*} transaction_id 
 * @param {*} uploadUrl 
 * @param {*} headers 
 */
function uploadFileInChunks(chunkSize, file, transaction_id, uploadUrl, headers) {
    // Build our blob array
    // Split our file into content chunks
    var chunkUploadPromiseArray = new Array();
    var chunkUploadAttempts = 5;
    var i = 0;
    var esc_name = escapeURL(file.name);

    chunkSize = file.size;
    while (i < file.size) {
        var endChunkSize = i + chunkSize;
        endChunkSize = (endChunkSize < file.size) ? endChunkSize : file.size;
        endChunkSize = endChunkSize - 1;
        var chunkBlob = file.slice(i, (endChunkSize + 1));

        headers.push({
            name: "Content-Disposition",
            value: "attachment; filename*=utf-8''" + esc_name
        });
        headers.push({
            name: "Content-Range",
            value: "bytes " + i + "-" + endChunkSize + "/" + file.size
        });
        headers.push({
            name: "Content-Type",
            value: "application/octet-stream"
        });
        headers.push({
            name: "transactionid",
            value: transaction_id
        });

        chunkUploadPromiseArray.push(httpReq("POST", uploadUrl, headers, chunkBlob, chunkUploadAttempts));

        i = endChunkSize + 1;
    }

    return Promise.all(chunkUploadPromiseArray).then(function (values) {
        return values;
    });
}


/**
 * 
 */
function submitForm() {
    let creds = getCredentials();
    let myfile = getFile();
    let vault_url = creds.url + "/vault/odata";
    var chunkSize = 4096;
    var file_id = generateNewGuid();
    var transaction_id = "";

    let basic_headers = [];
    basic_headers.push({
        name: "AUTHUSER",
        value: creds.user
    });
    basic_headers.push({
        name: "AUTHPASSWORD",
        value: creds.pwd
    });
    basic_headers.push({
        name: "DATABASE",
        value: creds.db
    });

    // 1. get transactionid
    let transaction_req = httpReq("POST", vault_url + "/vault.BeginTransaction", basic_headers);
    transaction_req
        .then(function (transaction_response) {
            transaction_id = JSON.parse(
                transaction_response.responseText.toString()
            ).transactionId;
            return transaction_id;

        })
        .then(function (transaction_id) {
            // 2. upload the file chunk(s)
            var uploadUrl = creds.url + "/vault/odata/vault.UploadFile?fileId=" + file_id;
            return uploadFileInChunks(chunkSize, myfile, transaction_id, uploadUrl, basic_headers);

        })
        .then(function (values) {
            // 3. commit the transaction
            var boundary = "batch_" + file_id;
            var commit_headers = [];
            commit_headers.push({
                name: "Content-Type",
                value: "multipart/mixed; boundary=" + boundary
            });
            commit_headers.push({
                name: "transactionid",
                value: transaction_id
            });
            commit_headers.push(basic_headers[0]);
            commit_headers.push(basic_headers[1]);
            commit_headers.push(basic_headers[2]);

            var commit_body = "--";
            commit_body += boundary + "\r\n";
            commit_body += "Content-Type: application/http\r\n\r\n";
            commit_body += "POST " + creds.url + "/Server/odata/File HTTP/1.1\r\n";
            commit_body += "Content-Type: application/json\r\n\r\n";
            commit_body += '{"id":"' + file_id + '",';
            commit_body += '"filename":"' + myfile.name + '",';
            commit_body += '"file_size":' + myfile.size + ',';
            commit_body += '"Located":[{"file_version":1,"related_id":"67BBB9204FE84A8981ED8313049BA06C"}]}\r\n';
            commit_body += "--" + boundary + "--";

            var completeUploadRequest = httpReq("POST", creds.url + "/vault/odata/vault.CommitTransaction", commit_headers, commit_body, 5);
            return completeUploadRequest;

        }).then(function (fileUploadResponse) {
            // 4. confirm the commit succeeded
            var test_url = creds.url + "/server/odata/file";
            var test_response = httpReq("GET", test_url, basic_headers);
            return test_response;

        }).then(function (test_res) {
            alert("Success! File saved with id = " + file_id);
            return file_id;
        })
        .catch(function (error) {
            console.log(error);
            alert(error);
        });
}


/**
 * 
 */
function generateNewGuid() {
    function randomDigit() {
        if (crypto && crypto.getRandomValues) {
            var rands = new Uint8Array(1);
            crypto.getRandomValues(rands);
            return (rands[0] % 16).toString(16);
        } else {
            return ((Math.random() * 16) | 0).toString(16);
        }
    }
    var crypto = window.crypto || window.msCrypto;
    return 'xxxxxxxxxxxx4xxx8xxxxxxxxxxxxxxx'.replace(/x/g, randomDigit).toUpperCase();
}


/**
 * escapes the following characters: %, ' ', ', !, ", #, $, &, (, ), *, +, ?
 * @param {*} url 
 */
function escapeURL(url) {
    url = url.split('%').join('%25');
    url = url.split(' ').join('%20');
    url = url.split("'").join('%27');
    url = url.split('!').join('%21');
    url = url.split('"').join('%22');
    url = url.split('#').join('%23');
    url = url.split('$').join('%24');
    url = url.split('&').join('%26');
    url = url.split('(').join('%28');
    url = url.split(')').join('%29');
    url = url.split('*').join('%2A');
    url = url.split('+').join('%2B');
    url = url.split('?').join('%3F');

    return url;
}