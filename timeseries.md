# Time series (High demand)

The time series endpoint provides detailed historical data for a specified financial instrument. It returns two main components: metadata, which includes essential information about the instrument, and a time series dataset. The time series consists of chronological entries with Open, High, Low, and Close prices, and for applicable instruments, it also includes trading volume. This endpoint is ideal for retrieving comprehensive historical price data for analysis or visualization purposes.

**API credits cost:** `1` per symbol

## Parameters

- `symbol` (string, optional, see notes)
  Symbol ticker of the instrument. E.g. `AAPL`, `EUR/USD`, `ETH/BTC`, ...
  Example value: `AAPL`


- `figi` (string, optional, see notes)
  The FIGI of an instrument for which data is requested. This parameter is available on the Ultra plan (individual) and the Enterprise plan (business) and above.
  Example value: `BBG000B9Y5X2`


- `isin` (string, optional, see notes)
  Filter by international securities identification number (ISIN). ISIN access is activating in the Data add-ons section
  Example value: `US0378331005`


- `cusip` (string, optional, see notes)
  The CUSIP of an instrument for which data is requested. CUSIP access is activating in the Data add-ons section
  Example value: `594918104`


- `interval` (string, required)
  Interval between two consecutive points in time series
  Example value: `1min`
  Available values: `1min`, `5min`, `15min`, `30min`, `45min`, `1h`, `2h`, `4h`, `8h`, `1day`, `1week`, `1month`


- `exchange` (string, optional)
  Exchange where instrument is traded
  Example value: `NASDAQ`


- `mic_code` (string, optional)
  Market Identifier Code (MIC) under ISO 10383 standard
  Example value: `XNAS`


- `country` (string, optional)
  The country where the instrument is traded, e.g., `United States` or `US`
  Example value: `United States`


- `type` (string, optional)
  The asset class to which the instrument belongs
  Example value: `Common Stock`
  Available values: `American Depositary Receipt`, `Bond`, `Bond Fund`, `Closed-end Fund`, `Common Stock`, `Depositary Receipt`, `Digital Currency`, `ETF`, `Exchange-Traded Note`, `Global Depositary Receipt`, `Limited Partnership`, `Mutual Fund`, `Physical Currency`, `Preferred Stock`, `REIT`, `Right`, `Structured Product`, `Trust`, `Unit`, `Warrant`


- `outputsize` (integer, optional)
  Number of data points to retrieve. Supports values in the range from `1` to `5000`. Default `30` when no date parameters are set, otherwise set to maximum
  Default value: `30`


- `format` (string, optional)
  The format of the response data
  Available values: `JSON`, `CSV`
  Default value: `JSON`


- `delimiter` (string, optional)
  The separator used in the CSV response data
  Default value: `;`


- `prepost` (boolean, optional)
  Returns quotes that include pre-market and post-market data. Only for the `Pro` plan (individual) and `Venture` plan (business) and above.
Available at the `1min`, `5min`, `15min`, and `30min` intervals for US equities.
Open, high, low, close values are supplied without volume
  Default value: `false`


- `dp` (integer, optional)
  Specifies the number of decimal places for floating values.
Should be in range [0, 11] inclusive.
By default, the number of decimal places is automatically determined based on the values provided
  Default value: `-1`


- `order` (string, optional)
  Sorting order of the output
  Available values: `asc`, `desc`
  Default value: `desc`


- `timezone` (string, optional)
  Timezone at which output datetime will be displayed. Supports:

1. Exchange for local exchange time
2. UTC for datetime at universal UTC standard
3. Timezone name according to the IANA Time Zone Database. E.g. America/New_York, Asia/Singapore. Full list of timezones can be found here

Interval Limitation: The timezone parameter is only applicable for intraday intervals (less than 1 day). For intervals of 1day, 1week, or 1month, the timezone parameter is ignored, and data is strictly returned in the Exchange local time.
Take note that the IANA Timezone name is case-sensitive
  Default value: `Exchange`


- `date` (string, optional)
  Specifies the exact date to get the data for. Could be the exact date, e.g. `2021-10-27`, or in human language `today` or `yesterday`
  Example value: `2021-10-27`


- `start_date` (string, optional)
  Can be used separately and together with `end_date`. Format `2006-01-02` or `2006-01-02T15:04:05`

Default location:

Forex and Cryptocurrencies - UTC
Stocks - where exchange is located (e.g. for AAPL it will be America/New_York)

Both parameters take into account if timezone parameter is provided.
If timezone is given then, start_date and end_date will be used in the specified location

Examples:

1. &symbol=AAPL&start_date=2019-08-09T15:50:00&…
Returns all records starting from 2019-08-09T15:50:00 New York time up to current date
2. &symbol=EUR/USD&timezone=Asia/Singapore&start_date=2019-08-09T15:50:00&…
Returns all records starting from 2019-08-09T15:50:00 Singapore time up to current date
3. &symbol=ETH/BTC&timezone=Europe/Zurich&start_date=2019-08-09T15:50:00&end_date=2019-08-09T15:55:00&...
Returns all records starting from 2019-08-09T15:50:00 Zurich time up to 2019-08-09T15:55:00

  Example value: `2024-08-22T15:04:05`


- `end_date` (string, optional)
  The ending date and time for data selection, see `start_date` description for details.
  Example value: `2024-08-22T16:04:05`


- `previous_close` (boolean, optional)
  A boolean parameter to include the previous closing price in the time_series data. If true, adds previous bar close price value to the current object
  Default value: `false`


- `adjust` (string, optional)
  Adjusting mode for prices
  Available values: `all`, `splits`, `dividends`, `none`
  Default value: `splits`


**Notes:**

 - At least one of the following parameters is required: `symbol`, `isin`, `figi`, `cusip`.

## Response

- `meta` (object)
  Json object with request general information
  - `symbol` (string)
    The ticker symbol of an instrument for which data was requested.
  - `interval` (string)
    The time gap between consecutive data points.
  - `currency` (string)
    The currency of a traded instrument.
  - `exchange_timezone` (string)
    The timezone of the exchange where the instrument is traded.
  - `exchange` (string)
    The exchange name where the instrument is traded.
  - `mic_code` (string)
    The Market Identifier Code (MIC) of the exchange where the instrument is traded.
  - `type` (string)
    The asset class to which the instrument belongs.

- `values` (array of object)
  List of time series data points
  - `datetime` (string)
    Datetime at local exchange time referring to when the bar with specified interval was opened.
  - `open` (string)
    Price at the opening of current bar
  - `high` (string)
    Highest price which occurred during the current bar.
  - `low` (string)
    Lowest price which occurred during the current bar.
  - `close` (string)
    Close price at the end of the bar.
  - `volume` (string)
    Trading volume which occurred during the current bar

- `status` (string)
  Response status


## Example Request

```bash
curl "https://api.twelvedata.com/time_series?symbol=AAPL&interval=1min&apikey=demo"
```

## Example Response

```json
{
    "meta": {
        "symbol": "AAPL",
        "interval": "1min",
        "currency": "USD",
        "exchange_timezone": "America/New_York",
        "exchange": "NASDAQ",
        "mic_code": "XNAS",
        "type": "Common Stock"
    },
    "values": [
        {
            "datetime": "2021-09-16 15:59:00",
            "open": "148.73500",
            "high": "148.86000",
            "low": "148.73000",
            "close": "148.85001",
            "volume": "624277"
        }
    ],
    "status": "ok"
}
```