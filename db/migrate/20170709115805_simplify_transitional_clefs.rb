class SimplifyTransitionalClefs < ActiveRecord::Migration[5.0]
  def change
    # Sections which transition from one clef to another
    # should be treated as the first clef, the knowledge
    # of the second clef is only for display, so we can
    # just set the clef string, we don't need a full relation.
    remove_column :clefs_inclusions, :changes_to
    remove_column :clefs_inclusions, :changes_from
    add_column :clefs_inclusions, :transitions_to, :string
  end
end
