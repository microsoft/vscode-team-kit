import install from '../../common/install-if-necessary.mts';

install().then(() => import('./check-bans-impl.mts')).then(({ main }) => main());
