const axios = require('axios')

const PAGE_SIZE = 10

class TimeoutError extends Error {}

const withRateLimit = (func, msRateLimit) => {
  let nextScheduled = Date.now()
  let first = true

  const scheduleCall = (args, startTime) => {
    console.log('startTime', startTime)
    return new Promise((resolve, reject) => {
      const delay = startTime - Date.now()
      console.log('delay', delay)
      if (first || delay <= 0) {
        resolve(func(args))
        first = false
        nextScheduled = Date.now()
      } else {
        setTimeout(() => resolve(func(args)), delay)
      }
    })
  }

  const getNextTime = () => (nextScheduled += msRateLimit)

  return args => scheduleCall(args, getNextTime())
}

const getBounties = withRateLimit(params => {
  return new Promise((resolve, reject) => {
    axios
      .get('https://gitcoin.co/api/v0.1/bounties/', {
        params: {
          is_open: true,
          order_by: '-web3_created',
          limit: PAGE_SIZE,
          ...params
        }
      })
      .then(res => {
        if (res.data && res.data[0] && res.data[0].url) {
          resolve(res.data)
        } else if (
          res.data &&
          res.data.includes(
            "Hold up, the bots want to know if you're one of them"
          )
        ) {
          reject(new TimeoutError())
        } else {
          reject(res.data)
        }
      })
  })
}, 3000)

const makeBountyFetcher = startTime => {
  let lastCheckedTime = startTime

  const fetchNew = async () => {
    const bountiesOfInterest = []

    try {
      let bounties = []
      let offset = 0
      do {
        bounties = (await getBounties({ offset })).filter(
          bounty => new Date(bounty.web3_created) > lastCheckedTime
        )
        bountiesOfInterest.push(...bounties)
        offset += PAGE_SIZE
      } while (bounties.length >= PAGE_SIZE)

      lastCheckedTime = new Date()
    } catch (e) {
      if (e instanceof TimeoutError) {
        console.log('Hit Gitcoin API timeout')
      } else {
        throw e
      }
    }

    return bountiesOfInterest
  }

  const listNew = async () => {
    const bounties = await fetchNew()
    console.log(
      bounties.map(
        ({ title, created_on }) => ({ title, created_on }) // eslint-disable-line camelcase
      )
    )
    console.log(bounties.length, 'new bounties')
  }

  return { listNew, fetchNew }
}

function main () {
  const interval = 10 * 60 * 1000
  const bountyFetcher = makeBountyFetcher(new Date('7/18/22'))
  // const bountyFetcher = makeBountyFetcher(new Date())
  bountyFetcher.listNew()
  setInterval(bountyFetcher.listNew, interval)
}

main()
