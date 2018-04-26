class GroupsController < ApplicationController
  def index
    groups = Group.order(:display_title)
    groups = GroupFilter.new(params).filter(groups)
    groups = groups.includes(
      :recordings,
      :functions,
      compositions: [
        :composers,
        inclusions: [
          :source,
          clefs_inclusions: [
            :clef,
          ],
        ],
      ],
      editions: [
        :editor,
      ],
    )

    @groups = groups.limit(200)
  end
end
