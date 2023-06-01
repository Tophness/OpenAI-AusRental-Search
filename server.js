const express = require('express');
const proxy = require('express-http-proxy');
const cheerio = require('cheerio');

function extractListingDetails(html) {
  const $ = cheerio.load(html);
  let nextPageNum = 2;
  let currentPageNum = 1;
  let totalListings = 0;
  const totalList = $('div.listings h1.text-heading strong');
  if(totalList && totalList.text()){
    totalListings = parseInt(totalList.text());
  }
  try {
    const activeLink = $('.pge a.-active');
    if (activeLink.length > 0) {
      currentPageNum = parseInt(activeLink.text().trim());
    }
    const lastPageElement = $('.listings .ui-pagination li.pge:last-child');
    const nextPageLink = lastPageElement.find('a[rel="next"]');
    if (nextPageLink.length !== 0) {
      const parts = nextPageLink.attr('href').split('/');
      const lastPart = parts[parts.length - 1];
      nextPageNum = parseInt(lastPart.replace('p', ''));
    }
  } catch (error) {}

  const returnJSON = {
    totalListings: totalListings,
    nextPageNum: nextPageNum,
    currentPageNum: currentPageNum,
    listings: []
  };

  $('article.property-cell').each((index, element) => {
    const address = $(element).find('h2.address').text().trim();
    const imageUrl = $(element).find('img.card-photo').attr('src');
    const priceElement = $(element).find('span.price');
    const propType = $(priceElement).find('.property-type').text().trim();
    priceElement.find('.property-type').remove();
    const price = priceElement.text().trim();
    const ldJsonScripts = $(element).find('script[type="application/ld+json"]').first();
    const features = [];
    let description = "";
    let url = "";

    $(element).find('ul.features li.feature').each((index, element) => {
      const value = $(element).find('span.value').text().trim();
      features.push(value);
    });

    if (ldJsonScripts.length > 0) {
      let jsonText = ldJsonScripts.html();
      jsonText = jsonText.replace('//<![CDATA[', '').replace('//]]>', '');
      try {
        const json = JSON.parse(jsonText);
        const isEmpty = Object.keys(json).length === 0;

        if (!isEmpty && json['@type'] !== "RentAction") {
          description = json.description;
          url = json.url;
        }
      } catch (error) {
        console.error('Error parsing JSON:', error);
      }
    }

    const listing = {
      address: address,
      imageUrl: imageUrl,
      price: price,
      features: features,
      propType: propType,
      description: description,
      url: url
    };

    returnJSON.listings.push(listing);
  });

  return returnJSON;
}

const app = express();
app.use(express.static('public'));

app.use('/rentdc', proxy('https://www.rent.com.au', {
  proxyReqOptDecorator: function (proxyReqOpts, srcReq) {
    if (srcReq.url.indexOf('/rentdc') !== -1) {
      srcReq.url = srcReq.url.replace('/rentdc', '/properties')
      proxyReqOpts.headers["Accept"] = "text/html";
    }
    proxyReqOpts.headers["Cookie"] = "";
    proxyReqOpts.headers["Access-Control-Allow-Origin"] = "*";
    proxyReqOpts.headers["Access-Control-Allow-Methods"] = "*";
    proxyReqOpts.headers["Access-Control-Allow-Headers"] = "*";
    proxyReqOpts.headers["Access-Control-Allow-Credentials"] = "true";
    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, req, res) {
    res.set("Access-Control-Allow-Origin","*");
    res.set("Access-Control-Allow-Methods","*");
    res.set("Access-Control-Allow-Headers","*");
    res.set("Access-Control-Allow-Credentials","true");
    res.set("x-amz-apigw-id","");
    res.set("x-amzn-remapped-connection","");
    res.set("x-amz-apigw-id","");
    res.set("x-amzn-remapped-date","");
    res.set("x-amzn-remapped-server","");
    res.set("x-amzn-requestid","");
    res.set("x-amz-apigw-id","");
    res.set("x-content-type-options","");
    res.set("x-frame-options","");
    res.set("x-amz-apigw-id","");
    res.set("x-permitted-cross-domain-policies","*");
    res.set("x-amz-apigw-id","");
    res.set("x-powered-by","");
    res.set("x-render-origin-server","");
    res.set("x-request-id","");
    res.set("x-xss-protection","");
    res.set("referrer-policy","");
    res.set("link","");
    res.set("etag","");

    if (req.url.indexOf('/rentdc') !== -1) {
      res.set("content-type", "application/json; charset=utf-8");
      res.set("accept", "application/json");
      const imgParam = req.url.match('[?&]images=([^&]+)');
      let returnJSON = extractListingDetails(proxyResData);
      if (imgParam && imgParam[1] == "0") {
        returnJSON.listings = returnJSON.listings.map(obj => {
          delete obj.imageUrl;
          return obj;
        });
      }
      return JSON.stringify(returnJSON);
    } else {
      return proxyResData;
    }
  }
}));

app.use('/domain', proxy('https://www.domain.com.au', {
  proxyReqOptDecorator: function (proxyReqOpts, srcReq) {
    if (srcReq.url.indexOf('/domain') !== -1) {
      srcReq.url = srcReq.url.replace('/domain', '/rent');
      proxyReqOpts.headers["content-type"] = "application/json; charset=utf-8";
      proxyReqOpts.headers["accept"] = "application/json";
    }
    proxyReqOpts.headers["Access-Control-Allow-Origin"] = "*";
    proxyReqOpts.headers["Access-Control-Allow-Methods"] = "*";
    proxyReqOpts.headers["Access-Control-Allow-Headers"] = "*";
    proxyReqOpts.headers["Access-Control-Allow-Credentials"] = "true";
    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, req, res) {
    if (req.url.indexOf('/domain') !== -1) {
      const data = JSON.parse(proxyResData.toString('utf8'));
      if (data.props && data.props.listingsMap) {
        let trimmedData = data.props.listingsMap;
        const numKeys = Object.keys(trimmedData);
        const numObjects = numKeys.length;
          if (numObjects > 50) {
          for (let i = 50; i < numObjects; i++) {
            delete trimmedData[numKeys[i]];
          }
        }
        for (const id in trimmedData) {
         if (trimmedData.hasOwnProperty(id)) {
           delete trimmedData[id].id;
           delete trimmedData[id].listingType;
           delete trimmedData[id].listingModel.skeletonImages;
           delete trimmedData[id].listingModel.auction;
           delete trimmedData[id].listingModel.branding;
           delete trimmedData[id].listingModel.brandingAppearance;
           delete trimmedData[id].listingModel.displaySearchPriceRange;
           delete trimmedData[id].listingModel.enableSingleLineAddress;
           delete trimmedData[id].listingModel.hasVideo;
           delete trimmedData[id].listingModel.promoType;
           delete trimmedData[id].listingModel.tags;
         }
        }
        const imgParam = req.url.match('[?&]images=([^&]+)');
        if (imgParam) {
          const numImages = parseInt(imgParam[1]);
          if(numImages > 0){
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                const images = trimmedData[key].listingModel.images;
                if (Array.isArray(images) && images.length > numImages) {
                  trimmedData[key].listingModel.images = images.slice(0, numImages);
                }
              }
            }
          }
          else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].listingModel.images;
              }
            }
          }
        }
        else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].listingModel.images;
              }
            }
        }
        trimmedData = {
          'totalPages': data.props.pageViewMetadata.searchResponse.SearchResults.totalPages,
          'page': data.props.pageViewMetadata.searchResponse.SearchResults.page,
          'totalResults': data.props.pageViewMetadata.searchResponse.SearchResults.totalResults,
          'resultsPerPage': data.props.listingSearchResultIds.length,
          'listings': trimmedData
        };
        return JSON.stringify(trimmedData);
      }
      else{
         return proxyResData;
      }
    }
    else{
       return proxyResData;
    }
  }
}));

app.use('/realestate', proxy('https://services.realestate.com.au/services/listings/search', {
  proxyReqOptDecorator: function (proxyReqOpts, srcReq) {
    if (srcReq.url.indexOf('/realestate?') !== -1) {
      srcReq.url = srcReq.url.replace('/realestate?', '/services/listings/search?')
    }
    proxyReqOpts.headers["Access-Control-Allow-Origin"] = "*";
    proxyReqOpts.headers["Access-Control-Allow-Methods"] = "*";
    proxyReqOpts.headers["Access-Control-Allow-Headers"] = "*";
    proxyReqOpts.headers["Access-Control-Allow-Credentials"] = "true";
    return proxyReqOpts;
  },
  userResDecorator: function(proxyRes, proxyResData, req, res) {
    if (req.url.indexOf('?query=') !== -1) {
      const data = JSON.parse(proxyResData.toString('utf8'));
      if (data.tieredResults) {
        let trimmedData = data.tieredResults[0].results;
        let returnJSON = {
          totalListings: data.totalResultsCount,
          currentPage: data.resolvedQuery.page,
          pageSize: data.resolvedQuery.pageSize,
          results: null
        };
        for (const id in trimmedData) {
         if (trimmedData.hasOwnProperty(id)) {
           delete trimmedData[id].standard;
           delete trimmedData[id].midtier;
           delete trimmedData[id].lister;
           delete trimmedData[id].featured;
           delete trimmedData[id]['_links'];
           delete trimmedData[id].signature;
           delete trimmedData[id].channel;
           delete trimmedData[id].advertising;
           delete trimmedData[id].showAgencyLogo;
           delete trimmedData[id].listers;
           delete trimmedData[id].productDepth;
           delete trimmedData[id].calculator;
           delete trimmedData[id].address.subdivisionCode;
           delete trimmedData[id].address.showAddress;
           delete trimmedData[id].address.locality;
           delete trimmedData[id].agency;
           delete trimmedData[id].isSoldChannel;
           delete trimmedData[id].isBuyChannel;
           delete trimmedData[id].signatureProject;
           delete trimmedData[id].listingId;
           delete trimmedData[id].classicProject;
           delete trimmedData[id].agencyListingId;
           delete trimmedData[id].mainImage;
           delete trimmedData[id].dateAvailable.dateDisplay;
           delete trimmedData[id].modifiedDate;
           delete trimmedData[id].isRentChannel;
           delete trimmedData[id].applyOnline;
         }
        }
        const imgParam = req.url.match('[?&]images=([^&]+)');
        if (imgParam) {
          const numImages = parseInt(imgParam[1]);
          if(numImages > 0){
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                const images = trimmedData[key].images;
                if (Array.isArray(images) && images.length > numImages) {
                  trimmedData[key].images = images.slice(0, numImages);
                }
              }
            }
          }
          else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].images;
              }
            }
          }
        }
        else{
            for (let key in trimmedData) {
              if (trimmedData.hasOwnProperty(key)) {
                delete trimmedData[key].images;
              }
            }
        }
        returnJSON.results = trimmedData;
        return JSON.stringify(returnJSON);
      }
      else{
         return proxyResData;
      }
    }
    else{
       return proxyResData;
    }
  }
}));

const server = app.listen(443);