module Admin
  class GroupsController < AdminControllerBase
    def index
      @groups = GroupFilter.filter(params)
        .order(:display_title)
        .limit(200)
        .includes(
          compositions: [
            :composers,
            inclusions: [
              :source,
            ],
          ],
        )
    end

    def merge
      if params[:groups].blank?
        flash[:error] = "You have to select groups to merge"
        redirect_to admin_groups_path(request.query_parameters)
        return
      end

      groups = Group.find(params[:groups])

      compositions = groups.flat_map(&:compositions)
      editions = groups.flat_map(&:editions)
      recordings = groups.flat_map(&:recordings)

      new_group = groups.shift

      new_group.display_title = params[:display_title] unless params[:display_title].blank?
      new_group.update!(
        compositions: compositions,
        editions: editions,
        recordings: recordings,
      )

      groups.each(&:destroy)

      redirect_to admin_groups_path(request.query_parameters)
    end

    def confirm_remove
      @group = Group.find(params[:id])
      @composition = Composition.find(params[:composition_id])
    end

    def remove
      composition = Composition.find(params[:composition_id])
      existing_group = composition.group

      composition.update(
        group: Group.create!(display_title: composition.title.text)
      )

      unless existing_group.reload.multiple?
        existing_group.update(display_title: existing_group.compositions.first.title.text)
      end

      redirect_to admin_groups_path(request.query_parameters.except(:composition_id))
    end
  end
end
