export function providerRoleDescriptionKey(role: string): string {
  if (role === 'vision') return 'role_description_vision';
  if (role === 'llm') return 'role_description_llm';
  if (role === 'image') return 'role_description_image';
  if (role === 'compliance_screen') return 'role_description_compliance_screen';
  return 'role_description_custom';
}
