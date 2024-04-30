import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet, useWalletRequest } from 'ui/utils';

import type { ChainWithBalance } from 'background/service/openapi';

import {
  findChain,
  findChainByServerID,
  DisplayChainWithWhiteLogo,
} from '@/utils/chain';

/** @deprecated import from '@/utils/chain' directly  */
export type { DisplayChainWithWhiteLogo };

const formatChain = (item: ChainWithBalance): DisplayChainWithWhiteLogo => {
  const chain = findChain({
    id: item.community_id,
  });

  return {
    ...item,
    logo: chain?.logo || item.logo_url,
    whiteLogo: chain?.whiteLogo,
  };
};

function normalizeChainList(chain_balances: ChainWithBalance[]) {
  return chain_balances
    .filter((item) => item.born_at !== null)
    .map(formatChain);
}

export function filterChainWithBalance(chainList: DisplayChainWithWhiteLogo[]) {
  return chainList.filter((item) => item.usd_value > 0);
}

export default function useCurrentBalance(
  account: string | undefined,
  opts?: {
    noNeedBalance?: boolean;
    update?: boolean;
    /**
     * @description in the future, only nonce >= 0, the fetching will be triggered
     */
    nonce?: number;
    initBalanceFromLocalCache?: boolean;
  }
) {
  const {
    update = false,
    noNeedBalance = false,
    nonce = 0,
    initBalanceFromLocalCache = false,
  } = opts || {};

  const wallet = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [success, setSuccess] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceFromCache, setBalanceFromCache] = useState(
    initBalanceFromLocalCache
  );
  let isCanceled = false;
  const [matteredChainBalances, setChainBalances] = useState<
    DisplayChainWithWhiteLogo[]
  >([]);

  const [missingList, setMissingList] = useState<string[]>();

  const [getAddressBalance] = useWalletRequest(wallet.getAddressBalance, {
    onSuccess({ total_usd_value, chain_list }) {
      if (isCanceled) return;
      setBalance(total_usd_value);
      setSuccess(true);
      const chainList = normalizeChainList(chain_list);

      setChainBalances(chainList);
      setBalanceLoading(false);
      setBalanceFromCache(false);
    },
    onError(e) {
      setBalanceLoading(false);
      try {
        const { error_code, err_chain_ids } = JSON.parse(e.message);
        if (error_code === 2) {
          const chainNames = err_chain_ids.map((serverId: string) => {
            const chain = findChainByServerID(serverId);
            return chain?.name;
          });
          setMissingList(chainNames);
          setSuccess(true);
          return;
        }
      } catch (e) {
        console.error(e);
      }
      setSuccess(false);
    },
  });

  const getCurrentBalance = async (force = false) => {
    if (!account || noNeedBalance) return;
    setBalanceLoading(true);
    const cacheData = await wallet.getAddressCacheBalance(account);
    const apiLevel = await wallet.getAPIConfig([], 'ApiLevel', false);
    if (cacheData) {
      setBalanceFromCache(true);
      setBalance(cacheData.total_usd_value);
      const chainList = normalizeChainList(cacheData.chain_list);
      setChainBalances(chainList);

      if (update) {
        if (apiLevel < 2) {
          setBalanceLoading(true);
          await getAddressBalance(account.toLowerCase(), force);
        } else {
          setBalanceLoading(false);
        }
      } else {
        setBalanceLoading(false);
      }
    } else {
      if (apiLevel < 2) {
        await getAddressBalance(account.toLowerCase(), force);
        setBalanceLoading(false);
        setBalanceFromCache(false);
      } else {
        setBalanceLoading(false);
      }
    }
  };

  const refresh = useCallback(async () => {
    await getCurrentBalance(true);
  }, [getCurrentBalance]);

  const isCurrentBalanceExpired = useCallback(async () => {
    if (!account) return false;

    try {
      return wallet.isAddressBalanceExpired(account.toLowerCase());
    } catch (error) {
      return false;
    }
  }, [account]);

  useEffect(() => {
    if (nonce < 0) return;

    getCurrentBalance();
    if (!noNeedBalance) {
      wallet.getAddressCacheBalance(account).then((cache) => {
        setChainBalances(cache ? normalizeChainList(cache.chain_list) : []);
      });
    }
    return () => {
      isCanceled = true;
    };
  }, [account, nonce]);

  const chainBalancesWithValue = useMemo(() => {
    return filterChainWithBalance(matteredChainBalances);
  }, [matteredChainBalances]);

  return {
    balance,
    matteredChainBalances,
    chainBalancesWithValue,
    isCurrentBalanceExpired,
    getAddressBalance,
    success,
    balanceLoading,
    balanceFromCache,
    refreshBalance: refresh,
    fetchBalance: getCurrentBalance,
    missingList,
  };
}
