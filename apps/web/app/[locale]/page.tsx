import { redirect } from 'next/navigation';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function LocaleIndex({ params }: Props) {
  const { locale } = await params;
  // localePrefix='as-needed' — default zh has no prefix.
  const target = locale === 'zh' ? '/dashboard' : `/${locale}/dashboard`;
  redirect(target);
}
