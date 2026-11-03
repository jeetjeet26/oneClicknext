import { redirect } from 'next/navigation'

export default function FloorPlansPage() {
  redirect('/dashboard/community?section=floorplans')
}
